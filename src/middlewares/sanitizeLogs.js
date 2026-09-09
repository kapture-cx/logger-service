const CONTROL_CHARACTERS = /[\x00-\x08\x0B-\x1F]/g;

const sanitize = (value) => {
  if (typeof value === "string") return value.replace(CONTROL_CHARACTERS, "");
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [sanitize(key), sanitize(item)]),
    );
  }
  return value;
};

export default (req, _res, next) => {
  req.body = sanitize(req.body);
  next();
};
