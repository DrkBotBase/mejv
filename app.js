require('dotenv').config();
const express = require('express');
const path = require('path');
const { Resend } = require('resend');

const { info, PORT, resendApiKey, gmail } = require('./config');

const app = express();
const resend = new Resend(resendApiKey);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set("trust proxy", 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.get('/', (req, res) => {
    res.render('landing', {
      info
    });
});

app.post('/contacto', async (req, res) => {
    const { nombre, contacto, servicio, mensaje } = req.body;
    
    try {
        await resend.emails.send({
            from: 'onboarding@resend.dev',
            to: gmail,
            subject: `🚀 Nueva solicitud de contacto: ${nombre}`,
            html: `
                <div style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: auto; border: 1px solid #ddd; padding: 20px; border-radius: 10px;">
                    <h2 style="color: #0041f2; border-bottom: 2px solid #0041f2; padding-bottom: 10px;">Nueva Solicitud de Proyecto</h2>
                    <p>Has recibido una nueva solicitud a través del formulario de tu sitio web.</p>
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr>
                            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Nombre:</strong></td>
                            <td style="padding: 10px; border-bottom: 1px solid #eee;">${nombre}</td>
                        </tr>
                        <tr>
                            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Contacto:</strong></td>
                            <td style="padding: 10px; border-bottom: 1px solid #eee;">${contacto}</td>
                        </tr>
                        <tr>
                            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Tipo de Servicio:</strong></td>
                            <td style="padding: 10px; border-bottom: 1px solid #eee;">${servicio}</td>
                        </tr>
                    </table>
                    <h3 style="color: #0041f2; margin-top: 20px;">Mensaje:</h3>
                    <p style="background: #f9f9f9; padding: 15px; border-left: 4px solid #0041f2; border-radius: 5px;">${mensaje}</p>
                    <p style="font-size: 12px; color: #888; margin-top: 30px;">Este mensaje fue enviado desde el formulario de contacto de tu sitio web.</p>
                </div>
            `
        });
        res.status(200).send('Correo enviado');
    } catch (error) {
        console.error('Error al enviar correo:', error);
        res.status(500).send('Error al enviar correo');
    }
});

// Middleware para manejar 404
app.use((req, res, next) => {
    res.status(404).render('404');
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en el puerto: ${PORT}`);
});