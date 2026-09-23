import Transaction, { INCOME_CATEGORIES, EXPENSE_CATEGORIES } from '../models/transactionModel.js';
import AppError from '../utils/appError.js';

function categoriesFor(type) {
  return type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
}

// GET /finance/transactions - requireAuth, restrictTo('admin', 'member').
// The club's finances are open-book to actual club members, but not to
// guests (logged-in dependents/others Authentik hasn't granted membership
// to); only adding new entries is admin-only (see createTransaction below).
export const getTransactions = async (req, res) => {
  const transactions = await Transaction.find().sort('-date');
  res.status(200).json({ status: 'success', data: { transactions } });
};

// POST /finance/transactions - requireAuth, restrictTo('admin').
export const createTransaction = async (req, res) => {
  const { date, name, type, category, amount, currency } = req.body;

  if (!date || !name?.trim() || !type || !category || amount == null) {
    throw new AppError('Hiányzó vagy hibás adatok.', 400);
  }
  if (!['income', 'expense'].includes(type)) {
    throw new AppError('Érvénytelen típus.', 400);
  }
  if (!categoriesFor(type).includes(category)) {
    throw new AppError('Érvénytelen kategória.', 400);
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError('Az összegnek pozitív számnak kell lennie.', 400);
  }

  const transaction = await Transaction.create({
    date,
    name: name.trim(),
    type,
    category,
    amount,
    currency: currency === 'EUR' ? 'EUR' : 'HUF',
    createdBy: req.user._id,
  });

  res.status(201).json({ status: 'success', data: { transaction } });
};
