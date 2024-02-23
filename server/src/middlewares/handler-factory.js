import catchAsync from '../utils/catch-async';
import AppError from '../utils/app-error';
import APIFeatures from '../utils/api-features';

const getModelName = (Model) => Model.modelName.toLowerCase();

const getCollectionName = (Model) => Model.collection.collectionName;

const getFilterObj = ({ paramName, foreignField }, req) => {
  const pName = req.params?.[paramName];
  return pName ? { [foreignField]: pName } : {};
};

const factory = {
  getAll(Model, options) {
    return catchAsync(async (req, res, next) => {
      let filterObj = {};

      if (typeof options === 'object' && Object.keys(options).length) {
        filterObj = getFilterObj(options, req);
      }

      const features = new APIFeatures(Model.find(filterObj), req.query)
        .filter()
        .sort()
        .limitFields()
        .paginate();

      const docs = await features.query;

      res.status(200).json({
        status: 'success',
        results: docs.length,
        data: {
          [getCollectionName(Model)]: docs,
        },
      });
    });
  },
  getOne(Model, populateOptions) {
    return catchAsync(async (req, res, next) => {
      let query = Model.findById(req.params.id);
      if (populateOptions) query = query.populate(populateOptions);

      const doc = await query;

      if (!doc) {
        return next(new AppError('No document found with that ID', 404));
      }

      res.status(200).json({
        status: 'success',
        data: { [getModelName(Model)]: doc },
      });
    });
  },
  createOne(Model) {
    return catchAsync(async (req, res, next) => {
      const doc = await Model.create(req.body);

      res.status(201).json({
        status: 'success',
        data: { [getModelName(Model)]: doc },
      });
    });
  },

  updateOne(Model) {
    return catchAsync(async (req, res, next) => {
      const doc = await Model.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true,
      });

      if (!doc) {
        return next(new AppError('No document found with that ID', 404));
      }

      res.status(200).json({
        status: 'success',
        data: { [getModelName(Model)]: doc },
      });
    });
  },
  deleteOne(Model) {
    return catchAsync(async (req, res, next) => {
      const doc = await Model.findByIdAndDelete(req.params.id);

      if (!doc) {
        return next(new AppError('No document found with that ID', 404));
      }

      res.status(204).json({
        status: 'success',
        data: null,
      });
    });
  },
};

export default factory;
