// SPDX-License-Identifier: Apache-2.0
//
// validate_schema tool handler. Validates a document against a canonical
// schema kind. A validation failure is a SUCCESSFUL call returning
// { valid:false, errors }, not an error result.

import { parse, type DocumentKind, type Validator, type ValidationResult } from "@mosvera/runtime";

export interface ValidateArgs {
  document: object | string;
  kind: DocumentKind;
}

export function runValidateSchema(validator: Validator, args: ValidateArgs): ValidationResult {
  let doc: object;
  try {
    doc = parse(args.document);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { valid: false, errors: [{ path: "", message: `parse error: ${message}` }] };
  }
  return validator.validate(doc, args.kind);
}
