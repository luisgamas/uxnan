import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { QuestionItem } from '@uxnan/shared';
import { answersByQuestion } from '../../src/adapters/user-input.js';

test('answersByQuestion keys each answer by its question, joins several labels, and refuses an empty set', () => {
  const questions: QuestionItem[] = [
    { question: 'Drink?', options: [{ label: 'Tea' }, { label: 'Coffee' }] },
    { question: 'Toppings?', options: [{ label: 'Ham' }, { label: 'Olives' }], multiple: true },
  ];
  assert.deepEqual(answersByQuestion(questions, [['Coffee'], ['Ham', 'Olives']]), {
    'Drink?': 'Coffee',
    'Toppings?': 'Ham, Olives',
  });
  assert.deepEqual(
    answersByQuestion(questions, [['Tea'], []]),
    { 'Drink?': 'Tea' },
    'a skipped one is left out',
  );
  assert.equal(answersByQuestion(questions, [[], []]), undefined);
  assert.equal(answersByQuestion(questions, []), undefined);
});
