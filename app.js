require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const mongoose = require('mongoose');
const { Resend } = require('resend');

const { info, PORT, resendApiKey, gmail, whatsappNumber, mongodbUri, adminUser, adminPassword, sessionSecret } = require('./config');

const app = express();
const resend = resendApiKey ? new Resend(resendApiKey) : null;

const campaignSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  message: { type: String, default: '', trim: true },
  active: { type: Boolean, default: true },
  clicks: { type: Number, default: 0 },
  lastClickedAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

const clickSchema = new mongoose.Schema({
  campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
  campaignSlug: { type: String, required: true },
  referrer: { type: String, default: '' },
  userAgent: { type: String, default: '' },
  ipHash: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

const Campaign = mongoose.models.Campaign || mongoose.model('Campaign', campaignSchema);
const Click = mongoose.models.Click || mongoose.model('Click', clickSchema);

let mongoReady = false;
let mongoConnectionPromise;
async function connectMongo() {
  if (!mongodbUri) return false;
  if (mongoReady) return true;
  if (!mongoConnectionPromise) {
    mongoConnectionPromise = mongoose.connect(mongodbUri, { serverSelectionTimeoutMS: 5000 })
      .then(() => { mongoReady = true; console.log('✅ MongoDB conectado'); return true; })
      .catch((error) => { console.error('❌ No se pudo conectar a MongoDB:', error.message); return false; });
  }
  return mongoConnectionPromise;
}

function isAdmin(req) { return Boolean(req.session && req.session.isAdmin); }
function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  res.redirect('/admin/login');
}
function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}
function getClientIp(req) {
  return (req.ip || req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim();
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 }
}));

app.get('/', (req, res) => res.render('landing', { info }));

app.get('/wa', async (req, res) => {
  const slug = normalizeSlug(req.query.campaign);
  if (!slug || !whatsappNumber) return res.status(400).send('Falta configurar la campaña o el número de WhatsApp.');
  const connected = await connectMongo();
  if (!connected) return res.status(503).send('El tracking no está disponible temporalmente.');

  const campaign = await Campaign.findOne({ slug, active: true });
  if (!campaign) return res.status(404).render('404');

  const ip = getClientIp(req);
  const ipHash = require('crypto').createHash('sha256').update(`${ip}:${process.env.IP_HASH_SALT || 'mejv'}`).digest('hex');
  await Promise.all([
    Click.create({ campaign: campaign._id, campaignSlug: campaign.slug, referrer: req.get('referer') || '', userAgent: req.get('user-agent') || '', ipHash }),
    Campaign.updateOne({ _id: campaign._id }, { $inc: { clicks: 1 }, $set: { lastClickedAt: new Date() } })
  ]);

  const text = campaign.message ? `?text=${encodeURIComponent(campaign.message)}` : '';
  res.redirect(`https://wa.me/${whatsappNumber}${text}`);
});

app.get('/admin/login', (req, res) => res.render('admin-login', { error: null }));
app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (!adminUser || !adminPassword || username === adminUser && password === adminPassword) {
    if (adminUser && adminPassword && username === adminUser && password === adminPassword) {
      req.session.isAdmin = true;
      return res.redirect('/admin/campaigns');
    }
  }
  res.status(401).render('admin-login', { error: 'Usuario o contraseña incorrectos.' });
});
app.post('/admin/logout', requireAdmin, (req, res) => req.session.destroy(() => res.redirect('/admin/login')));

app.get('/admin/campaigns', requireAdmin, async (req, res) => {
  const connected = await connectMongo();
  if (!connected) return res.status(503).send('Configura MONGODB_URI para usar el panel.');
  const campaigns = await Campaign.find().sort({ createdAt: -1 }).lean();
  res.render('admin-campaigns', { campaigns, baseUrl: info.dominio, error: req.query.error || null, success: req.query.success || null });
});
app.post('/admin/campaigns', requireAdmin, async (req, res) => {
  const connected = await connectMongo();
  if (!connected) return res.status(503).send('Configura MONGODB_URI para usar el panel.');
  const slug = normalizeSlug(req.body.slug);
  const name = String(req.body.name || '').trim().slice(0, 120);
  const message = String(req.body.message || '').trim().slice(0, 1000);
  if (!slug || !name) return res.redirect('/admin/campaigns?error=El+nombre+y+el+slug+son+obligatorios');
  try {
    await Campaign.create({ slug, name, message });
    res.redirect('/admin/campaigns?success=Campaña+creada');
  } catch (error) {
    const msg = error.code === 11000 ? 'Ese slug ya existe' : 'No se pudo crear la campaña';
    res.redirect(`/admin/campaigns?error=${encodeURIComponent(msg)}`);
  }
});
app.post('/admin/campaigns/:id/toggle', requireAdmin, async (req, res) => {
  const connected = await connectMongo();
  if (!connected) return res.status(503).send('Configura MONGODB_URI para usar el panel.');
  const campaign = await Campaign.findById(req.params.id);
  if (campaign) { campaign.active = !campaign.active; await campaign.save(); }
  res.redirect('/admin/campaigns');
});

app.post('/contacto', async (req, res) => {
  const { nombre, contacto, servicio, mensaje } = req.body;
  if (!resend) return res.status(500).send('El correo no está configurado');
  try {
    await resend.emails.send({ from: 'onboarding@resend.dev', to: gmail, subject: `🚀 Nueva solicitud de contacto: ${nombre}`, html: `<div><h2>Nueva Solicitud de Proyecto</h2><p><strong>Nombre:</strong> ${nombre}</p><p><strong>Contacto:</strong> ${contacto}</p><p><strong>Servicio:</strong> ${servicio}</p><p><strong>Mensaje:</strong> ${mensaje}</p></div>` });
    res.status(200).send('Correo enviado');
  } catch (error) { console.error('Error al enviar correo:', error); res.status(500).send('Error al enviar correo'); }
});

app.get('/ping', (req, res) => res.send('Pong'));
app.use((req, res) => res.status(404).render('404'));

if (require.main === module) {
  app.listen(PORT, () => console.log(`🚀 Servidor corriendo en el puerto ${PORT}`));
}
module.exports = { app, connectMongo, Campaign, Click };
