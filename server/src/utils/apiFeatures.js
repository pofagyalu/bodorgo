// GET /tours' query: what the address may ask for, and nothing more.
// Everything in it used to go to the database as it came - ?fields=+x
// showed the hidden fields (the NAS folder, the reviews), ?x.regex= or
// .ne/.in any operator. Now only what the app uses is read, and the rest
// of the address is ignored:
//   startDate.gte / .gt / .lte / .lt   a date (the Táborok page's year)
//   sort    order or startDate, with - for newest first
//   page, limit    whole numbers, limit at most MAX_LIMIT
// A value given twice (?sort=a&sort=b) comes as a list: ignored too.

const DATE_OPERATORS = ['gte', 'gt', 'lte', 'lt'];
const SORTS = ['order', '-order', 'startDate', '-startDate'];
const MAX_LIMIT = 100;

const text = (value) => (typeof value === 'string' ? value.trim() : undefined);

// A whole number from 1 up, or undefined - from the address (text), or as
// a number from the server's own aliases (aliasLastTours' limit: 3).
function positiveInt(value) {
  const s = typeof value === 'number' ? String(value) : text(value);
  if (!s || !/^\d+$/.test(s)) return undefined;
  const n = Number(s);
  return n >= 1 ? n : undefined;
}

export default class APIFeatures {
  constructor(query, queryString) {
    this.query = query;
    this.queryString = queryString ?? {};
  }

  filter() {
    const startDate = {};
    for (const operator of DATE_OPERATORS) {
      const value = text(this.queryString[`startDate.${operator}`]);
      const date = value ? new Date(value) : null;
      if (date && !Number.isNaN(date.getTime())) startDate[`$${operator}`] = date;
    }
    this.query = this.query.find(Object.keys(startDate).length ? { startDate } : {});
    return this;
  }

  sort(defaultSorting = '-order') {
    const asked = text(this.queryString.sort);
    this.query = this.query.sort(SORTS.includes(asked) ? asked : defaultSorting);
    return this;
  }

  // The fields are the model's own choice (select: false stays hidden) -
  // nothing in the address changes them.
  limitFields() {
    this.query = this.query.select('-__v');
    return this;
  }

  paginate() {
    const page = positiveInt(this.queryString.page) ?? 1;
    const limit = Math.min(positiveInt(this.queryString.limit) ?? MAX_LIMIT, MAX_LIMIT);
    this.query = this.query.skip((page - 1) * limit).limit(limit);
    return this;
  }
}
