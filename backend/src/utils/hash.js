import bcrypt from 'bcryptjs';

export const hashPassword = (plain) => bcrypt.hash(plain, 10);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

/** Strip sensitive fields from any record before returning over the API. */
export function sanitize(record) {
  if (!record) return record;
  const { passwordHash, ...rest } = record;
  return rest;
}

export default { hashPassword, verifyPassword, sanitize };
