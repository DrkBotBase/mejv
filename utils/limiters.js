const { rateLimit } = require('express-rate-limit');

const createLimiter = ({ windowMs, limit, message }) => {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message }
  });
};

module.exports = {
  contactLimiter: createLimiter({ windowMs: 15 * 60 * 1000, limit: 3, message: 'Demasiadas solicitudes. Intenta nuevamente en 15 minutos.' }),
  trackLimiter: createLimiter({ windowMs: 1 * 60 * 1000, limit: 5, message: 'Demasiadas descargas seguidas. Espera un momento.' }),
  apiLimiter: createLimiter({ windowMs: 10 * 60 * 1000, limit: 50, message: 'Límite de descargas alcanzado.' }),
  loginLimiter: createLimiter({ windowMs: 60 * 60 * 1000, limit: 5, message: 'Demasiados intentos de inicio de sesión.' })
};