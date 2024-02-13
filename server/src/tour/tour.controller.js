// import Tour from './tour.model.js';

export const getAllTours = (req, res) => {
  res.status(200).json({
    status: 'success',
  });
};

export const getTour = (req, res) => {};

export const createTour = (req, res) => {};

export const updateTour = (req, res) => {
  res.status(200).json({
    status: 'success',
    data: {
      tour: '<Updated tour here...>',
    },
  });
};

export const deleteTour = (req, res) => {
  res.status(204).json({
    status: 'success',
    data: null,
  });
};
