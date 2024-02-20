import catchAsync from '../utils/catch-async.js';
import AppError from '../utils/app-error.js';

const factory = {
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
