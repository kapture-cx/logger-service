const errorHandling = (err, _req, res, _next) => {
  const status =
    Number.isInteger(err.status) && err.status >= 400 && err.status <= 599
      ? err.status
      : err instanceof TypeError
        ? 400
        : 500;

  if (status === 500) {
    console.error(err);
  }

  return res.status(status).json({
    status,
    message: status < 500 || err.expose ? err.message : "Something went wrong",
    error: err.expose && err.details
      ? err.details
      : status === 500
        ? err.message
        : undefined,
  });
};

export default errorHandling;
