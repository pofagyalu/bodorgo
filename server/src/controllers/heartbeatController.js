const getSystemStatus = (req, res) => {
  res.status(200).json({
    status: 'OK',
    db: true,
  });
};

export default getSystemStatus;
