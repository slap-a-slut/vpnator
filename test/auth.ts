import type { Test } from 'supertest';

export const TEST_ADMIN_API_KEY = 'test-admin-key';

export function withAuth(requestTest: Test): Test {
  return requestTest.set('Authorization', `Bearer ${TEST_ADMIN_API_KEY}`);
}
