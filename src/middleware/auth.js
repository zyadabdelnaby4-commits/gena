const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_center_key_999';

const verifyToken = (req, res, next) => {
  let token = req.cookies?.token || req.headers['authorization'];
  
  if (token && typeof token === 'string' && token.startsWith('Bearer ')) {
    token = token.slice(7).trim();
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Access Denied: No session token provided.' });
  }

  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or expired session token.' });
  }
};

const requireRole = (role) => {
  return (req, res, next) => {
    verifyToken(req, res, () => {
      if (req.user && req.user.role === role) {
        next();
      } else {
        res.status(403).json({ success: false, message: 'Forbidden: Insufficient permissions.' });
      }
    });
  };
};

module.exports = {
  verifyToken,
  requireRole,
  JWT_SECRET
};
