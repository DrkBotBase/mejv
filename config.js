require('dotenv').config();
module.exports = {
  info: {
    author: 'DarkBox',
    name_page: 'Soluciones Digitales MEJV | Diseño Web Profesional para Personas y Negocios',
    desc: 'Creamos aplicaciones web progresivas (PWA), sitios web modernos, e-commerce y soluciones digitales rápidas, seguras y personalizadas para impulsar tu negocio.',
    dominio: process.env.DOMINIO || 'https://mejv.pro',
    version: process.env.VERSION || '1.0.0'
  },
  PORT: process.env.PORT || 3000,
  resendApiKey: process.env.RESEND_API_KEY,
  gmail: process.env.GMAIL,
  mongodbUri: process.env.MONGODB_URI,
  whatsappNumber: String(process.env.WHATSAPP_NUMBER || '+17755107666').replace(/\D/g, ''),
  adminUser: process.env.ADMIN_USER,
  adminPassword: process.env.ADMIN_PASSWORD,
  sessionSecret: process.env.SESSION_SECRET || 'change-this-session-secret'
};
