/**
 * Network-free tests for the Gemini failure classifier.
 *
 * The shapes below are built from the SDK's own error classes, so the test sees what
 * production sees. Hand-written message strings are not enough: an earlier version of
 * this classifier matched on a class name that the real SDK never sets, and every
 * hand-written test passed while production counted zero failures.
 *
 * Run: npm test   (or: npx tsx test/transport.test.ts)
 */
import assert from 'node:assert';
import {
  GoogleGenerativeAIAbortError,
  GoogleGenerativeAIError,
  GoogleGenerativeAIFetchError,
  GoogleGenerativeAIResponseError,
} from '@google/generative-ai';
import { TRANSPORT_SIGNATURE, isTransportError, classifySynthesisFailure } from '../src/transport';

// Hand-written messages first: the forms a log or a wrapper may show.
const quota = new Error('[429 Too Many Requests] You exceeded your current quota, please check your plan and billing details.');
quota.name = 'GoogleGenerativeAIFetchError';
assert.ok(isTransportError(quota), '429 quota is transport');
assert.ok(isTransportError(new Error('GoogleGenerativeAIFetchError: Error fetching from https://x: [503 Service Unavailable] The model is overloaded')), '5xx is transport');
assert.ok(isTransportError(new Error('GoogleGenerativeAIFetchError: Error fetching from https://x: fetch failed')), 'a socket failure the SDK wrapped is transport');
assert.ok(isTransportError('RESOURCE_EXHAUSTED: Quota exceeded for metric generate_requests_per_model_per_day'), 'the quota metric string is transport');
assert.equal(isTransportError(new Error('synthesis call returned no usable text (finishReason=SAFETY)')), false, 'a finishReason is not transport');
assert.equal(isTransportError(new Error('relation "signal_analysis" does not exist')), false, 'a database error is not transport');
assert.equal(isTransportError(null), false, 'null is not transport');

// The real SDK never puts the class name in the message: its errors keep name 'Error' and
// the message starts "[GoogleGenerativeAI Error]: ". Build them from its own classes.
const url = 'https://generativelanguage.googleapis.com/v1beta/models/m:generateContent';
const real: Array<[string, Error]> = [
  ['503', new GoogleGenerativeAIFetchError(`Error fetching from ${url}: [503 Service Unavailable] The service is currently unavailable.`, 503, 'Service Unavailable')],
  ['500', new GoogleGenerativeAIFetchError(`Error fetching from ${url}: [500 Internal Server Error] An internal error has occurred.`, 500, 'Internal Server Error')],
  ['429', new GoogleGenerativeAIFetchError(`Error fetching from ${url}: [429 Too Many Requests] Resource has been exhausted`, 429, 'Too Many Requests')],
  ['socket', new GoogleGenerativeAIError(`Error fetching from ${url}: fetch failed`)],
  ['timeout', new GoogleGenerativeAIAbortError(`Request aborted when fetching ${url}: This operation was aborted`)],
];
for (const [label, err] of real) assert.equal(classifySynthesisFailure(err), 'transport', `a real SDK ${label} error is transport`);

// A 4xx is a configuration fault (bad key, retired model name, oversize payload), not
// transit. Counting it as transport would read as a Google outage.
const config: Array<[string, Error]> = [
  ['400', new GoogleGenerativeAIFetchError(`Error fetching from ${url}: [400 Bad Request] API key not valid. Please pass a valid API key.`, 400, 'Bad Request')],
  ['403', new GoogleGenerativeAIFetchError(`Error fetching from ${url}: [403 Forbidden] Permission denied`, 403, 'Forbidden')],
  ['404', new GoogleGenerativeAIFetchError(`Error fetching from ${url}: [404 Not Found] models/gemini-1.5-flash is not found`, 404, 'Not Found')],
];
for (const [label, err] of config) assert.equal(classifySynthesisFailure(err), 'other', `a real SDK ${label} is a config fault, not transport`);

// A blocked or empty response is the model answering: never transport.
assert.notEqual(classifySynthesisFailure(new GoogleGenerativeAIResponseError('Text not available. Response was blocked due to SAFETY')), 'transport', 'a real SDK response error is not transport');

// A 429 has two independent routes into the signature: its status number and the status
// text. Each is pinned on its own, because removing one is hidden by the other (a mutation
// run showed the combined message still matching with the status number deleted).
assert.ok(TRANSPORT_SIGNATURE.test('Error fetching from https://x: [429 Unrecognised Text] body'), 'the status number 429 alone is transport');
assert.ok(TRANSPORT_SIGNATURE.test('Too Many Requests'), 'the status text alone is transport');

// The re-thrown "lost after the headers" error, which the SDK does not wrap itself.
assert.equal(classifySynthesisFailure(new Error('Gemini response body lost in transit: terminated')), 'transport', 'a body lost mid-stream is transit');

assert.equal(classifySynthesisFailure(quota), 'transport');
assert.equal(classifySynthesisFailure(new Error('synthesis call returned no usable text (finishReason=MAX_TOKENS)')), 'malformed', 'an unusable finish is malformed');
assert.equal(classifySynthesisFailure(new SyntaxError('Unexpected token < in JSON at position 0')), 'malformed', 'a JSON parse failure is malformed');
assert.equal(classifySynthesisFailure(new Error('connect ECONNREFUSED 127.0.0.1:5432')), 'other', 'a database connection failure is neither');
assert.equal(classifySynthesisFailure(new Error('malformed array literal: "{x}"')), 'other', 'a Postgres "malformed" is a database failure, not a model body');

console.log('transport tests passed');
