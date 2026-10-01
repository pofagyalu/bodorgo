export default class APIFeatures {
  constructor(query, queryString) {
    this.query = query;
    this.queryString = queryString;
  }

  filter() {
    // 1) Shallow copy of the req.query
    const queryObj = { ...this.queryString };

    // 2) Remove special fields
    const excludedFields = ['page', 'sort', 'limit', 'fields'];
    excludedFields.forEach((field) => delete queryObj[field]);

    // 3) Convert query operators to MongoDB operators ($gte, $gt, etc.)
    const mongoQuery = Object.entries(queryObj).reduce((acc, [key, value]) => {
      const [field, operator] = key.split('.');

      if (operator) {
        // Several operators on one field add up (a range: startDate.gte
        // and startDate.lt) - they used to overwrite each other.
        acc[field] = { ...acc[field], [`$${operator}`]: value };
      } else {
        acc[field] = value;
      }
      return acc;
    }, {});

    // 4) Build the Mongoose query
    this.query = this.query.find(mongoQuery);
    // let query = Tour.find(mongoQuery);
    return this;
  }

  static normalize(query) {
    if (Array.isArray(query)) {
      query = query.join(' ');
    }
    return query.replaceAll(',', ' ');
  }

  sort(defaultSorting = '-order') {
    if (this.queryString.sort) {
      const formatted = this.constructor.normalize(this.queryString.sort);
      this.query = this.query.sort(formatted);
    } else {
      this.query = this.query.sort(defaultSorting);
    }
    return this;
  }

  limitFields() {
    if (this.queryString.fields) {
      const formatted = this.constructor.normalize(this.queryString.fields);
      this.query = this.query.select(formatted);
    } else {
      this.query = this.query.select('-__v');
    }
    return this;
  }

  paginate() {
    const page = this.queryString.page * 1 || 1;
    const limit = this.queryString.limit * 1 || 100;
    const skip = (page - 1) * limit;

    this.query = this.query.skip(skip).limit(limit);

    return this;
  }
}
