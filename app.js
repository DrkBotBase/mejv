require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { Resend } = require('resend');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');

const {
  info,
  PORT,
  resendApiKey,
  gmail,
  whatsappNumber,
  mongodbUri,
  adminUser,
  adminPassword,
  sessionSecret
} = require('./config');

const app = express();

// ==================================================
// CONFIGURACIÓN GENERAL
// ==================================================

app.set('trust proxy', 1);

app.use(cors({
  origin: 'https://portfolio.mejv.pro',
  methods: ['POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: true, limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
  secret: sessionSecret || 'cambia-este-secreto-en-tu-entorno',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000
  }
}));

const resend = resendApiKey ? new Resend(resendApiKey) : null;

// ==================================================
// LÍMITE DE SOLICITUDES PARA EL FORMULARIO
// ==================================================

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    message: 'Demasiadas solicitudes. Intenta nuevamente en 15 minutos.'
  }
});

// ==================================================
// MODELOS DE CAMPAÑAS Y CLICS
// ==================================================

const campaignSchema = new mongoose.Schema({
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  message: {
    type: String,
    default: '',
    trim: true
  },
  active: {
    type: Boolean,
    default: true
  },
  clicks: {
    type: Number,
    default: 0
  },
  lastClickedAt: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const clickSchema = new mongoose.Schema({
  campaign: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    required: true
  },
  campaignSlug: {
    type: String,
    required: true
  },
  referrer: {
    type: String,
    default: ''
  },
  userAgent: {
    type: String,
    default: ''
  },
  ipHash: {
    type: String,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Campaign =
  mongoose.models.Campaign ||
  mongoose.model('Campaign', campaignSchema);

const Click =
  mongoose.models.Click ||
  mongoose.model('Click', clickSchema);

// ==================================================
// CONEXIÓN CON MONGODB
// ==================================================

let mongoReady = false;
let mongoConnectionPromise = null;

async function connectMongo() {
  if (mongoose.connection.readyState === 1) {
    mongoReady = true;
    return true;
  }

  if (!mongodbUri) {
    return false;
  }

  if (mongoReady) {
    return true;
  }

  if (!mongoConnectionPromise) {
    mongoConnectionPromise = mongoose.connect(mongodbUri, {
      serverSelectionTimeoutMS: 5000
    })
      .then(() => {
        mongoReady = true;
        console.log('✅ MongoDB conectado');
        return true;
      })
      .catch((error) => {
        mongoReady = false;
        mongoConnectionPromise = null;

        console.error(
          '❌ No se pudo conectar a MongoDB:',
          error.message
        );

        return false;
      });
  }

  return mongoConnectionPromise;
}

// ==================================================
// FUNCIONES AUXILIARES
// ==================================================

function isAdmin(req) {
  return Boolean(req.session && req.session.isAdmin);
}

function requireAdmin(req, res, next) {
  if (isAdmin(req)) {
    return next();
  }

  return res.redirect('/admin/login');
}

function normalizeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function getClientIp(req) {
  return String(req.ip || '');
}

function escapeHTML(value) {
  const entities = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };

  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    return entities[char];
  });
}

// ==================================================
// PÁGINA PRINCIPAL
// ==================================================

app.get('/', (req, res) => {
  res.render('landing', { info });
});

// ==================================================
// TRACKING DE CAMPAÑAS DE WHATSAPP
// URL DE EJEMPLO: /wa?campaign=mi-campana
// ==================================================

app.get('/wa', async (req, res) => {
  try {
    const slug = normalizeSlug(req.query.campaign);

    if (!slug || !whatsappNumber) {
      return res.status(400).send(
        'Falta configurar la campaña o el número de WhatsApp.'
      );
    }

    const connected = await connectMongo();

    if (!connected) {
      return res.status(503).send(
        'El tracking no está disponible temporalmente.'
      );
    }

    const campaign = await Campaign.findOne({
      slug,
      active: true
    });

    if (!campaign) {
      return res.status(404).render('404');
    }

    const ip = getClientIp(req);
    const salt = process.env.IP_HASH_SALT || 'mejv';

    const ipHash = crypto
      .createHash('sha256')
      .update(`${ip}:${salt}`)
      .digest('hex');

    await Promise.all([
      Click.create({
        campaign: campaign._id,
        campaignSlug: campaign.slug,
        referrer: req.get('referer') || '',
        userAgent: req.get('user-agent') || '',
        ipHash
      }),

      Campaign.updateOne(
        { _id: campaign._id },
        {
          $inc: { clicks: 1 },
          $set: { lastClickedAt: new Date() }
        }
      )
    ]);

    const text = campaign.message
      ? `?text=${encodeURIComponent(campaign.message)}`
      : '';

    return res.redirect(
      `https://wa.me/${whatsappNumber}${text}`
    );
  } catch (error) {
    console.error('Error en tracking de campaña:', error);

    return res.status(500).send(
      'No se pudo procesar la campaña.'
    );
  }
});

// ==================================================
// LOGIN DE ADMINISTRACIÓN
// ==================================================

app.get('/admin/login', (req, res) => {
  if (isAdmin(req)) {
    return res.redirect('/admin/campaigns');
  }

  return res.render('admin-login', { error: null });
});

app.post('/admin/login', (req, res, next) => {
  const { username, password } = req.body || {};

  if (
    !adminUser ||
    !adminPassword ||
    typeof username !== 'string' ||
    typeof password !== 'string'
  ) {
    return res.status(401).render('admin-login', {
      error: 'Usuario o contraseña incorrectos.'
    });
  }

  if (username !== adminUser || password !== adminPassword) {
    return res.status(401).render('admin-login', {
      error: 'Usuario o contraseña incorrectos.'
    });
  }

  // Regenerar la sesión para reducir el riesgo
  // de fijación de sesión.
  req.session.regenerate((error) => {
    if (error) {
      return next(error);
    }

    req.session.isAdmin = true;

    req.session.save((saveError) => {
      if (saveError) {
        return next(saveError);
      }

      return res.redirect('/admin/campaigns');
    });
  });
});

app.post('/admin/logout', requireAdmin, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) {
      return next(error);
    }

    res.clearCookie('connect.sid');
    return res.redirect('/admin/login');
  });
});

// ==================================================
// LISTADO DE CAMPAÑAS
// ==================================================

app.get('/admin/campaigns', requireAdmin, async (req, res) => {
  try {
    const connected = await connectMongo();

    if (!connected) {
      return res.status(503).send(
        'Configura MONGODB_URI para usar el panel.'
      );
    }

    const campaigns = await Campaign.find()
      .sort({ createdAt: -1 })
      .lean();

    return res.render('admin-campaigns', {
      campaigns,
      baseUrl: info.dominio,
      error: req.query.error || null,
      success: req.query.success || null
    });
  } catch (error) {
    console.error('Error cargando campañas:', error);

    return res.status(500).send(
      'No se pudieron cargar las campañas.'
    );
  }
});

// ==================================================
// CREAR CAMPAÑA
// ==================================================

app.post('/admin/campaigns', requireAdmin, async (req, res) => {
  try {
    const connected = await connectMongo();

    if (!connected) {
      return res.status(503).send(
        'Configura MONGODB_URI para usar el panel.'
      );
    }

    const slug = normalizeSlug(req.body.slug);
    const name = String(req.body.name || '')
      .trim()
      .slice(0, 120);

    const message = String(req.body.message || '')
      .trim()
      .slice(0, 1000);

    if (!slug || !name) {
      return res.redirect(
        '/admin/campaigns?error=El+nombre+y+el+slug+son+obligatorios'
      );
    }

    await Campaign.create({
      slug,
      name,
      message
    });

    return res.redirect(
      '/admin/campaigns?success=Campaña+creada'
    );
  } catch (error) {
    console.error('Error creando campaña:', error);

    const msg = error.code === 11000
      ? 'Ese slug ya existe'
      : 'No se pudo crear la campaña';

    return res.redirect(
      `/admin/campaigns?error=${encodeURIComponent(msg)}`
    );
  }
});

// ==================================================
// ACTIVAR O DESACTIVAR CAMPAÑA
// ==================================================

app.post(
  '/admin/campaigns/:id/toggle',
  requireAdmin,
  async (req, res) => {
    try {
      const connected = await connectMongo();

      if (!connected) {
        return res.status(503).send(
          'Configura MONGODB_URI para usar el panel.'
        );
      }

      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).send('ID de campaña inválido.');
      }

      const campaign = await Campaign.findById(req.params.id);

      if (campaign) {
        campaign.active = !campaign.active;
        await campaign.save();
      }

      return res.redirect('/admin/campaigns');
    } catch (error) {
      console.error('Error actualizando campaña:', error);

      return res.status(500).send(
        'No se pudo actualizar la campaña.'
      );
    }
  }
);

// ==================================================
// FORMULARIO DE CONTACTO - RESEND
// POST /contacto
// ==================================================

app.post('/contacto', contactLimiter, async (req, res) => {
  if (!resend || !gmail) {
    return res.status(500).json({
      message: 'El servicio de correo no está configurado.'
    });
  }

  const {
    nombre,
    contacto,
    servicio,
    mensaje
  } = req.body || {};

  // Validar tipos de datos
  if (
    typeof nombre !== 'string' ||
    typeof contacto !== 'string' ||
    typeof servicio !== 'string' ||
    typeof mensaje !== 'string'
  ) {
    return res.status(400).json({
      message: 'Los datos enviados no son válidos.'
    });
  }

  // Limpiar espacios
  const data = {
    nombre: nombre.trim(),
    contacto: contacto.trim(),
    servicio: servicio.trim(),
    mensaje: mensaje.trim()
  };

  // Validar campos obligatorios
  if (
    !data.nombre ||
    !data.contacto ||
    !data.servicio ||
    !data.mensaje
  ) {
    return res.status(400).json({
      message: 'Todos los campos son obligatorios.'
    });
  }

  // Limitar longitud
  if (
    data.nombre.length > 100 ||
    data.contacto.length > 200 ||
    data.servicio.length > 150 ||
    data.mensaje.length > 5000
  ) {
    return res.status(400).json({
      message: 'Uno o más campos superan la longitud permitida.'
    });
  }

  try {
    const { error } = await resend.emails.send({
      from: 'onboarding@resend.dev',
      to: gmail,
      subject: `Nueva solicitud de contacto: ${data.nombre}`,
      html: `
        <div style="font-family:sans-serif;line-height:1.6;color:#333;max-width:600px;margin:auto;padding:20px;">
          <h2 style="color:#4f46e5;">
            Nueva solicitud de proyecto
          </h2>

          <p>
            <strong>Nombre:</strong>
            ${escapeHTML(data.nombre)}
          </p>

          <p>
            <strong>Contacto:</strong>
            ${escapeHTML(data.contacto)}
          </p>

          <p>
            <strong>Servicio:</strong>
            ${escapeHTML(data.servicio)}
          </p>

          <h3>Mensaje</h3>

          <p style="white-space:pre-wrap;">
            ${escapeHTML(data.mensaje)}
          </p>

          <hr>

          <small>
            Mensaje recibido desde el formulario de contacto.
          </small>
        </div>
      `
    });

    if (error) {
      console.error('Error de Resend:', error);

      return res.status(502).json({
        message: 'No se pudo enviar el correo.'
      });
    }

    return res.status(200).json({
      message: 'Correo enviado correctamente.'
    });
  } catch (error) {
    console.error('Error al enviar correo:', error);

    return res.status(500).json({
      message: 'Error interno al enviar el correo.'
    });
  }
});

// ==================================================
// RUTA DE PRUEBA
// ==================================================

app.get('/ping', (req, res) => {
  res.send('Pong');
});

// ==================================================
// PÁGINA 404
// ==================================================

app.use((req, res) => {
  res.status(404).render('404');
});

// ==================================================
// MANEJO DE ERRORES
// ==================================================

app.use((error, req, res, next) => {
  console.error('Error del servidor:', error);

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).send('Error interno del servidor.');
});

// ==================================================
// INICIAR SERVIDOR
// ==================================================

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
  });
}

module.exports = {
  app,
  connectMongo,
  Campaign,
  Click
};