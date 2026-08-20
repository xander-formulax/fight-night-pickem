// monday sends the frontend a short-lived session token; the backend verifies
// it with the app's signing secret before serving anything.
import jwt from 'jsonwebtoken';
import { config } from './config.js';

export function verifySessionToken(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer /i, '') || req.query.sessionToken;
  if (!token) return res.status(401).json({ error: 'missing session token' });
  try {
    req.session = jwt.verify(token, config.clientSecret);
    next();
  } catch {
    res.status(401).json({ error: 'invalid session token' });
  }
}
