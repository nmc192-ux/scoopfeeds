import { ZodError } from "zod";
import { sendValidationError } from "../utils/apiResponse.js";

export function validate(schema, source = "body") {
  return (req, res, next) => {
    try {
      req.validated = req.validated || {};
      req.validated[source] = schema.parse(req[source] || {});
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return sendValidationError(res, req, error);
      }
      return next(error);
    }
  };
}
