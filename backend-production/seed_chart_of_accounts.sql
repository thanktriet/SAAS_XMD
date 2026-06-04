-- ============================================================
-- SEED: chart_of_accounts

-- ============================================================

DO $$
DECLARE
  v_org_id UUID := '00000000-0000-0000-0000-000000000001';
BEGIN

INSERT INTO acc_accounts
  (org_id, account_code, account_name, account_name_en,
   parent_code, level, account_type, normal_balance,
   is_detail, is_system, account_group, account_number, display_order)
VALUES

(v_org_id, '151', 'Hng mua ang i ng',          'Goods in transit',            '15',  3, 'asset', 'debit', FALSE, FALSE, 'group_1', '151', 151),
(v_org_id, '152', 'Nguyn liu, vt liu',            'Raw materials',               '15',  3, 'asset', 'debit', FALSE, FALSE, 'group_1', '152', 152),
(v_org_id, '153', 'Cng c, dng c',                 'Tools and supplies',          '15',  3, 'asset', 'debit', FALSE, TRUE,  'group_1', '153', 153),
(v_org_id, '156', 'Hng ha',                         'Merchandise',                 '15',  3, 'asset', 'debit', FALSE, TRUE,  'group_1', '156', 156),
(v_org_id, '1561','Gi mua hng ha (xe my in)',   'Electric motorcycle - cost',  '156', 4, 'asset', 'debit', TRUE,  TRUE,  'group_1', '1561',1561),
(v_org_id, '157', 'Hng gi i bn',                  'Consignment goods',           '15',  3, 'asset', 'debit', TRUE,  FALSE, 'group_1', '157', 157),

(v_org_id, '242', 'Chi ph tr trc',                'Prepaid expenses',            '2',   2, 'asset', 'debit', FALSE, TRUE,  'group_2', '242', 242),

(v_org_id, '3382','Kinh ph cng on',               'Union fund',                  '338', 4, 'liability','credit',TRUE,TRUE,'group_3','3382',3382),
(v_org_id, '3383','Bo him x hi',                  'Social insurance',            '338', 4, 'liability','credit',TRUE,TRUE,'group_3','3383',3383),
(v_org_id, '3384','Bo him y t',                    'Health insurance',            '338', 4, 'liability','credit',TRUE,TRUE,'group_3','3384',3384),
(v_org_id, '3386','Bo him tht nghip',             'Unemployment insurance',      '338', 4, 'liability','credit',TRUE,TRUE,'group_3','3386',3386),
(v_org_id, '3387','Doanh thu cha thc hin',         'Unearned revenue',            '338', 4, 'liability','credit',TRUE,FALSE,'group_3','3387',3387),

(v_org_id, '5111A','Doanh thu bn xe my in',       'Electric motorcycle sales',   '5111',5, 'revenue','credit',TRUE,TRUE, 'group_5','5111A',51111),
(v_org_id, '5113A','DT dch v sa cha, bo dng', 'Repair & maintenance revenue','5113',5, 'revenue','credit',TRUE,TRUE, 'group_5','5113A',51131),
(v_org_id, '5113B','DT dch v ng k, ph xe',     'Vehicle registration revenue','5113',5, 'revenue','credit',TRUE,TRUE, 'group_5','5113B',51132),

(v_org_id, '6411','CP nhn vin bn hng',            'Sales staff costs',           '641', 4, 'expense','debit', TRUE, FALSE,'group_6','6411',6411),
(v_org_id, '6412','CP vt liu, bao b bn hng',    'Sales materials & packaging', '641', 4, 'expense','debit', TRUE, FALSE,'group_6','6412',6412),
(v_org_id, '6413','CP dng c bn hng',              'Sales tools',                 '641', 4, 'expense','debit', TRUE, FALSE,'group_6','6413',6413),
(v_org_id, '6414','CP khu hao TSC bn hng',       'Sales depreciation',          '641', 4, 'expense','debit', TRUE, FALSE,'group_6','6414',6414),
(v_org_id, '6415','CP bo hnh sn phm',            'Warranty expenses',           '641', 4, 'expense','debit', TRUE, TRUE, 'group_6','6415',6415),
(v_org_id, '6417','CP dch v mua ngoi (BH)',       'Outsourced services (sales)',  '641', 4, 'expense','debit', TRUE, FALSE,'group_6','6417',6417),
(v_org_id, '6418','CP bng tin khc (BH)',           'Other selling expenses',      '641', 4, 'expense','debit', TRUE, FALSE,'group_6','6418',6418),
(v_org_id, '6421','CP nhn vin qun l',             'Management staff costs',      '642', 4, 'expense','debit', TRUE, FALSE,'group_6','6421',6421),
(v_org_id, '6425','CP kim ton, t vn',            'Audit & consulting fees',     '642', 4, 'expense','debit', TRUE, FALSE,'group_6','6425',6425),
(v_org_id, '6427','CP dch v mua ngoi (QL)',       'Outsourced services (admin)', '642', 4, 'expense','debit', TRUE, FALSE,'group_6','6427',6427),
(v_org_id, '6428','CP bng tin khc (QL)',           'Other admin expenses',        '642', 4, 'expense','debit', TRUE, FALSE,'group_6','6428',6428)

ON CONFLICT (org_id, account_code) DO NOTHING;

END $$;
