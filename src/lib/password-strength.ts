import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import { adjacencyGraphs, dictionary as commonDictionary } from '@zxcvbn-ts/language-common';
import { dictionary as englishDictionary, translations } from '@zxcvbn-ts/language-en';
import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH, utf8ByteLength } from './password-policy';

// Loaded only when a password is entered. No network matchers or password cache.
const estimator = new ZxcvbnFactory({
  translations,
  graphs: adjacencyGraphs,
  dictionary: { ...commonDictionary, ...englishDictionary },
});

/** An offline guessability estimate, not a leaked-password or registration check. */
export function estimatePasswordStrength(password: string): number {
  if (password.length < PASSWORD_MIN_LENGTH || utf8ByteLength(password) > PASSWORD_MAX_BYTES) return 0;
  return estimator.check(password).score;
}
