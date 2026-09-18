// ScreenSync lightweight argument validation at extension boundary (Plan §3.1 & D4)
// Validates agent arguments before reaching executeScript / CDP calls without bundling dependencies.
import { ERROR_CODES, makeError } from './errors.js';

export function validateToolArgs(tool, args) {
  if (args == null || typeof args !== 'object') {
    return makeError(ERROR_CODES.BAD_ARGS, `Arguments for ${tool} must be an object.`);
  }

  switch (tool) {
    case 'web_navigate': {
      if (typeof args.url !== 'string' || !/^https?:/i.test(args.url.trim())) {
        return makeError(ERROR_CODES.BAD_ARGS, 'web_navigate requires a valid http(s) url string.');
      }
      break;
    }
    case 'web_click':
    case 'web_hover':
    case 'web_focus':
    case 'web_scroll_to': {
      const hasTarget = Boolean(args.selector || args.text || args.role || args.ref != null || args.by);
      if (!hasTarget) {
        return makeError(ERROR_CODES.BAD_ARGS, `${tool} requires a target selector, text, role, ref, or by locator.`);
      }
      break;
    }
    case 'web_type':
    case 'web_fill': {
      const hasTarget = Boolean(args.selector || args.text || args.role || args.ref != null || args.by);
      if (!hasTarget) {
        return makeError(ERROR_CODES.BAD_ARGS, `${tool} requires a target selector, text, role, ref, or by locator.`);
      }
      if (args.text == null && args.value == null) {
        return makeError(ERROR_CODES.BAD_ARGS, `${tool} requires a 'text' or 'value' string to type.`);
      }
      break;
    }
    case 'web_eval': {
      if (typeof args.expression !== 'string' && typeof args.code !== 'string') {
        return makeError(ERROR_CODES.BAD_ARGS, 'web_eval requires an expression or code string.');
      }
      break;
    }
    case 'web_run_code': {
      if (typeof args.code !== 'string') {
        return makeError(ERROR_CODES.BAD_ARGS, 'web_run_code requires a code string.');
      }
      break;
    }
    case 'web_route': {
      if (typeof args.pattern !== 'string' && typeof args.urlPattern !== 'string' && typeof args.url !== 'string') {
        return makeError(ERROR_CODES.BAD_ARGS, 'web_route requires a pattern or urlPattern string.');
      }
      break;
    }
    case 'web_wait_for_url': {
      if (typeof args.url !== 'string' && typeof args.pattern !== 'string') {
        return makeError(ERROR_CODES.BAD_ARGS, 'web_wait_for_url requires a url or pattern string.');
      }
      break;
    }
    case 'web_upload_file': {
      if (!args.files && !args.path && !args.filePath && !args.base64Data) {
        return makeError(ERROR_CODES.BAD_ARGS, 'web_upload_file requires files, filePath, or base64Data.');
      }
      break;
    }
  }

  return null;
}
