/**
 * Query Builder Adapter — tương thích API Supabase PostgREST
 * Chạy trên pg Pool, trả về { data, error, count } giống Supabase.
 */
const pool = require('../database');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse select string để tách columns chính và relations.
 * Hỗ trợ nested relations: "*, sales_order_items(inventory_vehicle_id, vehicle_models(warranty_months))"
 * → { columns: ['*'], relations: [{ table: 'sales_order_items', columns: [...], fk: null, nested: [...] }] }
 */
function parseSelect(selectStr) {
  if (!selectStr) return { columns: ['*'], relations: [] };

  const relations = [];
  const columns = [];

  // Tokenize: split by comma at top level (respect nested parentheses)
  const tokens = splitTopLevel(selectStr);

  for (const token of tokens) {
    const trimmed = token.trim();
    if (!trimmed) continue;

    // Check if token contains a relation: table_name(...)  or table_name!fk(...)
    const relMatch = trimmed.match(/^(\w+)(?:!(\w+))?\s*\((.+)\)$/s);
    if (relMatch) {
      const [, table, fkHint, inner] = relMatch;
      // Parse inner: may contain nested relations
      const innerParsed = parseSelect(inner);
      relations.push({
        table,
        columns: innerParsed.columns,
        fk: fkHint || null,
        nested: innerParsed.relations,
      });
    } else {
      // Regular column, possibly with alias: "confirmed_by_user:confirmed_by(full_name)"
      const aliasRelMatch = trimmed.match(/^(\w+):(\w+)\s*\((.+)\)$/s);
      if (aliasRelMatch) {
        const [, alias, fkCol, inner] = aliasRelMatch;
        const innerParsed = parseSelect(inner);
        relations.push({
          table: null, // will be resolved from FK
          columns: innerParsed.columns,
          fk: fkCol,
          alias,
          nested: innerParsed.relations,
        });
      } else {
        columns.push(trimmed);
      }
    }
  }

  if (columns.length === 0 && relations.length > 0) columns.push('*');

  return { columns, relations };
}

/**
 * Split string by comma at top level (không split bên trong parentheses)
 */
function splitTopLevel(str) {
  const result = [];
  let depth = 0;
  let current = '';

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '(') { depth++; current += ch; }
    else if (ch === ')') { depth--; current += ch; }
    else if (ch === ',' && depth === 0) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) result.push(current);
  return result;
}

/**
 * Parse Supabase-style .or() filter string.
 * Ví dụ: "full_name.ilike.%search%,email.ilike.%search%"
 * → [{ col: 'full_name', op: 'ilike', val: '%search%' }, ...]
 */
function parseOrFilter(orStr) {
  const parts = [];
  // Split by comma but respect dots in values
  // Pattern: col.operator.value
  const regex = /(\w+)\.(eq|neq|ilike|like|gt|gte|lt|lte|is|in)\.(.+?)(?=,\w+\.\w+\.|$)/g;
  let match;
  while ((match = regex.exec(orStr)) !== null) {
    parts.push({ col: match[1], op: match[2], val: match[3] });
  }
  // Fallback: simple split
  if (parts.length === 0) {
    orStr.split(',').forEach(part => {
      const dotIdx1 = part.indexOf('.');
      const dotIdx2 = part.indexOf('.', dotIdx1 + 1);
      if (dotIdx1 > 0 && dotIdx2 > 0) {
        parts.push({
          col: part.substring(0, dotIdx1),
          op: part.substring(dotIdx1 + 1, dotIdx2),
          val: part.substring(dotIdx2 + 1),
        });
      }
    });
  }
  return parts;
}

/**
 * Convert operator + value thành SQL condition
 */
function opToSQL(col, op, val, params) {
  const paramIdx = params.length + 1;
  switch (op) {
    case 'eq':
      if (val === 'true') { params.push(true); return `"${col}" = $${paramIdx}`; }
      if (val === 'false') { params.push(false); return `"${col}" = $${paramIdx}`; }
      if (val === 'null') return `"${col}" IS NULL`;
      params.push(val);
      return `"${col}" = $${paramIdx}`;
    case 'neq':
      if (val === 'null') return `"${col}" IS NOT NULL`;
      params.push(val);
      return `"${col}" != $${paramIdx}`;
    case 'gt':
      params.push(val);
      return `"${col}" > $${paramIdx}`;
    case 'gte':
      params.push(val);
      return `"${col}" >= $${paramIdx}`;
    case 'lt':
      params.push(val);
      return `"${col}" < $${paramIdx}`;
    case 'lte':
      params.push(val);
      return `"${col}" <= $${paramIdx}`;
    case 'like':
      params.push(val);
      return `"${col}" LIKE $${paramIdx}`;
    case 'ilike':
      params.push(val);
      return `"${col}" ILIKE $${paramIdx}`;
    case 'is':
      if (val === 'null') return `"${col}" IS NULL`;
      if (val === 'true') return `"${col}" IS TRUE`;
      if (val === 'false') return `"${col}" IS FALSE`;
      return `"${col}" IS NULL`;
    case 'in':
      // val format: (val1,val2,val3)
      const inVals = val.replace(/^\(|\)$/g, '').split(',').map(v => v.trim());
      const placeholders = inVals.map((v, i) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `"${col}" IN (${placeholders.join(',')})`;
    default:
      params.push(val);
      return `"${col}" = $${paramIdx}`;
  }
}

// ─── FK Relationship Detection ────────────────────────────────────────────────

// Cache FK relationships
let fkCache = null;

async function getForeignKeys() {
  if (fkCache) return fkCache;
  const result = await pool.query(`
    SELECT
      c.conrelid::regclass::text AS from_table,
      a.attname AS from_column,
      c.confrelid::regclass::text AS to_table,
      af.attname AS to_column
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attnum = ANY(c.conkey) AND a.attrelid = c.conrelid
    JOIN pg_attribute af ON af.attnum = ANY(c.confkey) AND af.attrelid = c.confrelid
    WHERE c.contype = 'f'
  `);
  fkCache = result.rows;
  return fkCache;
}

/**
 * Tìm FK column nối từ mainTable → relatedTable
 */
async function findFK(mainTable, relatedTable, fkHint) {
  const fks = await getForeignKeys();
  if (fkHint) {
    // fkHint là tên column (e.g., users!created_by → column created_by)
    const found = fks.find(
      fk => fk.from_table === mainTable && fk.from_column === fkHint && fk.to_table === relatedTable
    );
    if (found) return found;
    // fkHint có thể là column name mà FK trỏ tới bất kỳ table nào
    const byCol = fks.find(
      fk => fk.from_table === mainTable && fk.from_column === fkHint
    );
    if (byCol) return byCol;
  }
  // Auto-detect: tìm FK từ mainTable → relatedTable
  const found = fks.find(
    fk => fk.from_table === mainTable && fk.to_table === relatedTable
  );
  if (found) return found;
  // Reverse: relatedTable → mainTable (one-to-many)
  const reverse = fks.find(
    fk => fk.from_table === relatedTable && fk.to_table === mainTable
  );
  if (reverse) return { ...reverse, reverse: true };
  return null;
}

/**
 * Post-fetch: load relations cho một mảng rows từ parentTable.
 * Mutates rows in-place, thêm key cho mỗi relation.
 */
async function loadRelations(parentTable, rows, relations) {
  if (!relations || relations.length === 0 || rows.length === 0) return;

  for (const rel of relations) {
    let targetTable = rel.table;
    const alias = rel.alias || rel.table;
    const fk = await findFK(parentTable, targetTable, rel.fk);

    if (!targetTable && fk) {
      targetTable = fk.to_table;
    }
    if (!fk && !targetTable) {
      // Fallback: skip
      for (const row of rows) row[alias] = null;
      continue;
    }

    if (!fk) {
      // Guess FK
      const guessCol = targetTable.replace(/s$/, '') + '_id';
      const ids = [...new Set(rows.map(r => r[guessCol]).filter(Boolean))];
      if (ids.length === 0) { for (const row of rows) row[alias] = null; continue; }
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
      const result = await pool.query(`SELECT * FROM "${targetTable}" WHERE "id" IN (${placeholders})`, ids);
      const map = {};
      for (const r of result.rows) map[r.id] = r;
      for (const row of rows) {
        const related = map[row[guessCol]] || null;
        row[alias] = related ? pickColumns(related, rel.columns) : null;
      }
      if (rel.nested && rel.nested.length > 0 && result.rows.length > 0) {
        await loadRelations(targetTable, result.rows, rel.nested);
        // Re-map after nested load
        for (const row of rows) {
          const related = map[row[guessCol]] || null;
          row[alias] = related ? pickColumns(related, rel.columns, rel.nested) : null;
        }
      }
      continue;
    }

    if (fk.reverse) {
      // One-to-many: targetTable has FK pointing to parentTable
      const parentIds = [...new Set(rows.map(r => r[fk.to_column]).filter(Boolean))];
      if (parentIds.length === 0) { for (const row of rows) row[alias] = []; continue; }
      const placeholders = parentIds.map((_, i) => `$${i + 1}`).join(',');
      const result = await pool.query(
        `SELECT * FROM "${targetTable}" WHERE "${fk.from_column}" IN (${placeholders})`,
        parentIds
      );

      // Load nested relations on the fetched rows
      if (rel.nested && rel.nested.length > 0 && result.rows.length > 0) {
        await loadRelations(targetTable, result.rows, rel.nested);
      }

      // Group by parent FK
      const grouped = {};
      for (const r of result.rows) {
        const key = r[fk.from_column];
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(pickColumns(r, rel.columns, rel.nested));
      }
      for (const row of rows) {
        row[alias] = grouped[row[fk.to_column]] || [];
      }
    } else {
      // Many-to-one: parentTable has FK to targetTable
      const fkValues = [...new Set(rows.map(r => r[fk.from_column]).filter(Boolean))];
      if (fkValues.length === 0) { for (const row of rows) row[alias] = null; continue; }
      const placeholders = fkValues.map((_, i) => `$${i + 1}`).join(',');
      const result = await pool.query(
        `SELECT * FROM "${targetTable}" WHERE "${fk.to_column}" IN (${placeholders})`,
        fkValues
      );

      // Load nested relations
      if (rel.nested && rel.nested.length > 0 && result.rows.length > 0) {
        await loadRelations(targetTable, result.rows, rel.nested);
      }

      const map = {};
      for (const r of result.rows) map[r[fk.to_column]] = r;
      for (const row of rows) {
        const related = map[row[fk.from_column]] || null;
        row[alias] = related ? pickColumns(related, rel.columns, rel.nested) : null;
      }
    }
  }
}

/**
 * Pick specified columns from a row. If columns includes '*', return all.
 * Also includes nested relation keys.
 */
function pickColumns(row, columns, nestedRels) {
  if (!row) return null;
  if (columns.includes('*')) {
    return { ...row };
  }
  const result = {};
  for (const col of columns) {
    if (col in row) result[col] = row[col];
  }
  // Include nested relation keys
  if (nestedRels) {
    for (const nr of nestedRels) {
      const key = nr.alias || nr.table;
      if (key in row) result[key] = row[key];
    }
  }
  return result;
}

// ─── Query Builder Class ──────────────────────────────────────────────────────

class QueryBuilder {
  constructor(tableName) {
    this._table = tableName;
    this._operation = 'select'; // select | insert | update | delete
    this._selectStr = '*';
    this._selectOptions = {};
    this._filters = [];
    this._orFilters = [];
    this._orderBy = [];
    this._rangeFrom = null;
    this._rangeTo = null;
    this._insertData = null;
    this._updateData = null;
    this._returnData = false;
    this._single = false;
    this._maybeSingle = false;
    this._autoBranchId = null; // Auto branch filter for multi-tenant
  }

  select(columns, options) {
    // Nếu đã set operation (insert/update), chỉ đánh dấu returnData
    // Không override operation
    if (this._operation === 'insert' || this._operation === 'update' || this._operation === 'delete') {
      this._returnData = true;
      if (columns && columns !== '*') this._returnColumns = columns;
      return this;
    }
    this._operation = 'select';
    this._selectStr = columns || '*';
    this._selectOptions = options || {};
    this._returnData = true;
    return this;
  }

  insert(data) {
    this._operation = 'insert';
    this._insertData = Array.isArray(data) ? data : [data];
    this._returnData = false;
    return this;
  }

  update(data) {
    this._operation = 'update';
    this._updateData = data;
    this._returnData = false;
    return this;
  }

  delete() {
    this._operation = 'delete';
    this._returnData = false;
    return this;
  }

  // ─── Filters ─────────────────────────────────────────────────────────────

  eq(col, val) {
    this._filters.push({ type: 'eq', col, val });
    return this;
  }

  neq(col, val) {
    this._filters.push({ type: 'neq', col, val });
    return this;
  }

  gt(col, val) {
    this._filters.push({ type: 'gt', col, val });
    return this;
  }

  gte(col, val) {
    this._filters.push({ type: 'gte', col, val });
    return this;
  }

  lt(col, val) {
    this._filters.push({ type: 'lt', col, val });
    return this;
  }

  lte(col, val) {
    this._filters.push({ type: 'lte', col, val });
    return this;
  }

  like(col, val) {
    this._filters.push({ type: 'like', col, val });
    return this;
  }

  ilike(col, val) {
    this._filters.push({ type: 'ilike', col, val });
    return this;
  }

  is(col, val) {
    this._filters.push({ type: 'is', col, val });
    return this;
  }

  in(col, vals) {
    this._filters.push({ type: 'in', col, val: vals });
    return this;
  }

  not(col, op, val) {
    this._filters.push({ type: 'not', col, op, val });
    return this;
  }

  or(orString) {
    this._orFilters.push(orString);
    return this;
  }

  filter(col, op, val) {
    // Supabase .filter('qty_in_stock', 'lte', 'qty_minimum')
    // Nếu val là tên column (không phải giá trị), so sánh 2 columns
    this._filters.push({ type: 'raw_filter', col, op, val });
    return this;
  }

  // ─── Ordering & Pagination ────────────────────────────────────────────────

  order(col, options) {
    const ascending = options?.ascending !== false;
    const nullsFirst = options?.nullsFirst || false;
    this._orderBy.push({ col, ascending, nullsFirst });
    return this;
  }

  range(from, to) {
    this._rangeFrom = from;
    this._rangeTo = to;
    return this;
  }

  limit(n) {
    this._rangeTo = (this._rangeFrom || 0) + n - 1;
    return this;
  }

  // ─── Result modifiers ─────────────────────────────────────────────────────

  single() {
    this._single = true;
    this._returnData = true;
    return this;
  }

  maybeSingle() {
    this._maybeSingle = true;
    this._returnData = true;
    return this;
  }

  // ─── Execute (thenable) ───────────────────────────────────────────────────

  then(resolve, reject) {
    return this._execute().then(resolve, reject);
  }

  catch(fn) {
    return this._execute().catch(fn);
  }

  async _execute() {
    try {
      switch (this._operation) {
        case 'select':
          return await this._execSelect();
        case 'insert':
          return await this._execInsert();
        case 'update':
          return await this._execUpdate();
        case 'delete':
          return await this._execDelete();
        default:
          return { data: null, error: { message: `Unknown operation: ${this._operation}` } };
      }
    } catch (err) {
      return { data: null, error: { message: err.message, details: err.detail || null } };
    }
  }

  // ─── Build WHERE clause ───────────────────────────────────────────────────

  _buildWhere(params, tableAlias) {
    const conditions = [];
    const prefix = tableAlias ? `${tableAlias}.` : '';

    for (const f of this._filters) {
      const paramIdx = params.length + 1;
      const col = `${prefix}"${f.col}"`;

      switch (f.type) {
        case 'eq':
          if (f.val === null) { conditions.push(`${col} IS NULL`); break; }
          if (f.val === true || f.val === false) { params.push(f.val); conditions.push(`${col} = $${paramIdx}`); break; }
          params.push(f.val);
          conditions.push(`${col} = $${paramIdx}`);
          break;
        case 'neq':
          if (f.val === null) { conditions.push(`${col} IS NOT NULL`); break; }
          params.push(f.val);
          conditions.push(`${col} != $${paramIdx}`);
          break;
        case 'gt':
          params.push(f.val); conditions.push(`${col} > $${paramIdx}`); break;
        case 'gte':
          params.push(f.val); conditions.push(`${col} >= $${paramIdx}`); break;
        case 'lt':
          params.push(f.val); conditions.push(`${col} < $${paramIdx}`); break;
        case 'lte':
          params.push(f.val); conditions.push(`${col} <= $${paramIdx}`); break;
        case 'like':
          params.push(f.val); conditions.push(`${col} LIKE $${paramIdx}`); break;
        case 'ilike':
          params.push(f.val); conditions.push(`${col} ILIKE $${paramIdx}`); break;
        case 'is':
          if (f.val === null || f.val === 'null') conditions.push(`${col} IS NULL`);
          else if (f.val === true || f.val === 'true') conditions.push(`${col} IS TRUE`);
          else if (f.val === false || f.val === 'false') conditions.push(`${col} IS FALSE`);
          break;
        case 'in':
          if (Array.isArray(f.val) && f.val.length > 0) {
            const placeholders = f.val.map(v => { params.push(v); return `$${params.length}`; });
            conditions.push(`${col} IN (${placeholders.join(',')})`);
          } else {
            conditions.push('FALSE'); // empty IN = no results
          }
          break;
        case 'not':
          // .not('col', 'is', null) → col IS NOT NULL
          if (f.op === 'is' && (f.val === null || f.val === 'null')) {
            conditions.push(`${col} IS NOT NULL`);
          } else if (f.op === 'eq') {
            params.push(f.val); conditions.push(`${col} != $${paramIdx}`);
          } else if (f.op === 'in' && Array.isArray(f.val)) {
            const placeholders = f.val.map(v => { params.push(v); return `$${params.length}`; });
            conditions.push(`${col} NOT IN (${placeholders.join(',')})`);
          }
          break;
        case 'raw_filter': {
          // Check if val looks like a column name (no spaces, no special chars except _)
          const isColumnRef = /^[a-z_][a-z0-9_]*$/i.test(f.val) && !['true','false','null'].includes(f.val);
          const rightSide = isColumnRef ? `${prefix}"${f.val}"` : (() => { params.push(f.val); return `$${params.length}`; })();
          switch (f.op) {
            case 'eq': conditions.push(`${col} = ${rightSide}`); break;
            case 'neq': conditions.push(`${col} != ${rightSide}`); break;
            case 'gt': conditions.push(`${col} > ${rightSide}`); break;
            case 'gte': conditions.push(`${col} >= ${rightSide}`); break;
            case 'lt': conditions.push(`${col} < ${rightSide}`); break;
            case 'lte': conditions.push(`${col} <= ${rightSide}`); break;
            default: conditions.push(`${col} = ${rightSide}`);
          }
          break;
        }
      }
    }

    // OR filters
    for (const orStr of this._orFilters) {
      const parts = parseOrFilter(orStr);
      if (parts.length > 0) {
        const orConditions = parts.map(p => opToSQL(p.col, p.op, p.val, params));
        conditions.push(`(${orConditions.join(' OR ')})`);
      }
    }

    return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  }

  // ─── SELECT execution ─────────────────────────────────────────────────────

  async _execSelect() {
    // Auto-inject branch filter
    if (this._autoBranchId) {
      this._filters.push({ type: 'eq', col: 'branch_id', val: this._autoBranchId });
    }

    const { columns, relations } = parseSelect(this._selectStr);
    const wantCount = this._selectOptions.count === 'exact';
    const headOnly = this._selectOptions.head === true;
    const params = [];

    // Build main columns (no relation subqueries — those are loaded post-fetch)
    let mainCols;
    if (columns.includes('*')) {
      mainCols = `"${this._table}".*`;
    } else {
      mainCols = columns.map(c => `"${this._table}"."${c}"`).join(', ');
    }

    const whereClause = this._buildWhere(params, this._table);

    // Order
    let orderClause = '';
    if (this._orderBy.length > 0 && !headOnly) {
      const parts = this._orderBy.map(o => {
        const dir = o.ascending ? 'ASC' : 'DESC';
        const nulls = o.nullsFirst ? 'NULLS FIRST' : 'NULLS LAST';
        return `"${this._table}"."${o.col}" ${dir} ${nulls}`;
      });
      orderClause = `ORDER BY ${parts.join(', ')}`;
    }

    // Pagination — .limit(n) sets only _rangeTo; .range(from,to) sets both.
    // Default offset to 0 when _rangeFrom is null so bare .limit() works.
    let limitClause = '';
    if (this._rangeTo !== null && !headOnly) {
      const offset = this._rangeFrom || 0;
      const limit = this._rangeTo - offset + 1;
      limitClause = `LIMIT ${limit} OFFSET ${offset}`;
    }

    // Head-only (count only)
    if (headOnly) {
      const sql = `SELECT COUNT(*) as __count FROM "${this._table}" ${whereClause}`;
      const result = await pool.query(sql, params);
      return { data: null, error: null, count: parseInt(result.rows[0].__count) };
    }

    // Main query — only main table columns
    const sql = `SELECT ${mainCols} FROM "${this._table}" ${whereClause} ${orderClause} ${limitClause}`;
    const result = await pool.query(sql, params);

    // Count query (separate)
    let count = null;
    if (wantCount) {
      const countParams = [];
      const countWhere = this._buildWhere(countParams, this._table);
      const countSql = `SELECT COUNT(*) as __count FROM "${this._table}" ${countWhere}`;
      const countResult = await pool.query(countSql, countParams);
      count = parseInt(countResult.rows[0].__count);
    }

    let data = result.rows;

    // Post-fetch: load relations
    if (relations.length > 0 && data.length > 0) {
      await loadRelations(this._table, data, relations);
    }

    // single / maybeSingle
    if (this._single) {
      if (data.length === 0) {
        return { data: null, error: { message: 'Row not found', code: 'PGRST116' }, count };
      }
      data = data[0];
    } else if (this._maybeSingle) {
      data = data.length > 0 ? data[0] : null;
    }

    return { data, error: null, count };
  }

  // ─── INSERT execution ─────────────────────────────────────────────────────

  async _execInsert() {
    if (!this._insertData || this._insertData.length === 0) {
      return { data: null, error: { message: 'No data to insert' } };
    }

    // Auto-inject branch_id into insert data — luôn override để tránh branch hopping
    let rows = this._insertData;
    if (this._autoBranchId) {
      rows = rows.map(r => ({ ...r, branch_id: this._autoBranchId }));
    }

    const allKeys = [...new Set(rows.flatMap(r => Object.keys(r)))];
    const params = [];
    const valueRows = rows.map(row => {
      const vals = allKeys.map(key => {
        params.push(row[key] !== undefined ? row[key] : null);
        return `$${params.length}`;
      });
      return `(${vals.join(', ')})`;
    });

    const colList = allKeys.map(k => `"${k}"`).join(', ');
    const returning = this._returnData ? 'RETURNING *' : '';
    const sql = `INSERT INTO "${this._table}" (${colList}) VALUES ${valueRows.join(', ')} ${returning}`;

    const result = await pool.query(sql, params);
    let data = this._returnData ? result.rows : null;

    if (this._single && data) {
      data = data.length > 0 ? data[0] : null;
    } else if (this._maybeSingle && data) {
      data = data.length > 0 ? data[0] : null;
    }

    return { data, error: null, count: result.rowCount };
  }

  // ─── UPDATE execution ─────────────────────────────────────────────────────

  async _execUpdate() {
    if (!this._updateData || Object.keys(this._updateData).length === 0) {
      return { data: null, error: { message: 'No data to update' } };
    }

    // Auto-inject branch filter
    if (this._autoBranchId) {
      this._filters.push({ type: 'eq', col: 'branch_id', val: this._autoBranchId });
    }

    const params = [];
    const setClauses = Object.entries(this._updateData).map(([key, val]) => {
      params.push(val);
      return `"${key}" = $${params.length}`;
    });

    const whereClause = this._buildWhere(params, null);
    const returning = this._returnData ? 'RETURNING *' : '';
    const sql = `UPDATE "${this._table}" SET ${setClauses.join(', ')} ${whereClause} ${returning}`;

    const result = await pool.query(sql, params);
    let data = this._returnData ? result.rows : null;

    if (this._single && data) {
      if (data.length === 0) {
        return { data: null, error: { message: 'Row not found', code: 'PGRST116' } };
      }
      data = data[0];
    } else if (this._maybeSingle && data) {
      data = data.length > 0 ? data[0] : null;
    }

    return { data, error: null, count: result.rowCount };
  }

  // ─── DELETE execution ─────────────────────────────────────────────────────

  async _execDelete() {
    // Auto-inject branch filter
    if (this._autoBranchId) {
      this._filters.push({ type: 'eq', col: 'branch_id', val: this._autoBranchId });
    }

    const params = [];
    const whereClause = this._buildWhere(params, null);

    if (!whereClause) {
      return { data: null, error: { message: 'DELETE without WHERE clause is not allowed' } };
    }

    const returning = this._returnData ? 'RETURNING *' : '';
    const sql = `DELETE FROM "${this._table}" ${whereClause} ${returning}`;

    const result = await pool.query(sql, params);
    let data = this._returnData ? result.rows : null;

    if (this._single && data) {
      data = data.length > 0 ? data[0] : null;
    }

    return { data, error: null, count: result.rowCount };
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

function from(tableName) {
  return new QueryBuilder(tableName);
}

module.exports = { from, pool, QueryBuilder };
