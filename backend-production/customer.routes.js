const router = require('express').Router();
const { getCustomers, createCustomer, getCustomerDetail, updateCustomer } = require('./customer.controller');
const { authenticate } = require('./auth.middleware');
const { validate } = require('./validate.middleware');
const { createCustomerRules, updateCustomerRules } = require('./customer.validator');

router.use(authenticate);
router.get('/', getCustomers);
router.post('/', createCustomerRules, validate, createCustomer);
router.get('/:id', getCustomerDetail);
router.put('/:id', updateCustomerRules, validate, updateCustomer);

module.exports = router;
