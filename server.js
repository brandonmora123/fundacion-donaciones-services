// server.js
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();
const app = express();

// Middlewares
const allowedOrigins = [
  'http://localhost:3000',
  'https://fundacion-donaciones-site-production.up.railway.app'
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS no permitido'));
    }
  },
  credentials: true
}));

app.use(express.json());


// Conexión a MySQL (Railway)
const db = mysql.createPool({
  host: 'ballast.proxy.rlwy.net',
  port: '27807',
  user: 'root',
  password: 'MbfaNyhHRDcGlKNxGbwHzEvGqzgpmgDI',
  database: 'railway',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: false
});

// Verificar conexión
db.getConnection()
  .then(conn => {
    console.log('✅ Conexión a la base de datos exitosa');
    conn.release();
  })
  .catch(err => {
    console.error('❌ Error al conectar a la base de datos:', err.message);
  });


// Middleware de autenticación
const auth = (roles = []) => {
  return async (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Acceso denegado: Token no proporcionado' });

    try {
      const decoded = jwt.verify(token, 'secreto_tesis_2025');
      const [rows] = await db.execute(
        'SELECT u.*, r.nombre_rol FROM usuarios u JOIN roles r ON u.id_rol = r.id_rol WHERE id_usuario = ? AND activo = 1',
        [decoded.id]
      );
      if (rows.length === 0) return res.status(403).json({ error: 'Usuario no autorizado' });

      req.user = rows[0]; // Ahora incluye el nombre_rol

      // Verificar rol
      if (roles.length > 0 && !roles.includes(req.user.nombre_rol)) {
        return res.status(403).json({ error: 'Permiso denegado: Rol no autorizado' });
      }

      next();
    } catch (err) {
      return res.status(403).json({ error: 'Token inválido o expirado' });
    }
  };
};

// Hacer db y auth disponibles globalmente
app.set('db', db);
app.set('auth', auth);

// Ruta: Login
// backend/server.js
app.post('/api/auth/login', async (req, res) => {
    const { correo, contrasena } = req.body;
    try {
      const [rows] = await db.execute(`
        SELECT u.*, r.nombre_rol 
        FROM usuarios u 
        JOIN roles r ON u.id_rol = r.id_rol 
        WHERE u.correo = ? AND u.activo = 1
      `, [correo]);
  
      if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
  
      const user = rows[0];
      const validPassword = await bcrypt.compare(contrasena, user.contrasena);
      if (!validPassword) return res.status(401).json({ error: 'Contraseña incorrecta' });
  
      const token = jwt.sign(
        { id: user.id_usuario, rol: user.id_rol, nombre_rol: user.nombre_rol },
        'secreto_tesis_2025',
        { expiresIn: '24h' }
      );
  
      res.json({
        token,
        user: {
          id: user.id_usuario,
          nombre: user.nombre,
          apellido: user.apellido,
          rol: user.id_rol,
          nombre_rol: user.nombre_rol
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

// Ruta: Dashboard
app.get('/api/dashboard', auth(), async (req, res) => {
  try {
    const [[{ total }]] = await db.execute('SELECT COUNT(*) as total FROM donaciones WHERE estado = "Disponible"');
    const [[{ entregas }]] = await db.execute('SELECT COUNT(*) as entregas FROM entrega');
    const [[{ campanas }]] = await db.execute('SELECT COUNT(*) as campanas FROM campanas WHERE estado = "En curso"');
    const [[{ donacionesHoy }]] = await db.execute('SELECT COUNT(*) as donacionesHoy FROM donaciones WHERE fecha_ingreso = CURDATE()');

    res.json({ inventario: total, entregas, campanas, donacionesHoy: donacionesHoy || 0 });
  } catch (err) {
    console.error('Error en dashboard:', err);
    res.status(500).json({ error: err.message });
  }
});

// Ruta: Listar donaciones
app.get('/api/donaciones', auth(), async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT d.*, 
             CONCAT(don.nombre, ' ', don.apellido) as donante_nombre, 
             don.empresa,
             c.nombre_categoria as categoria,
             u.nombre as registrado_por
      FROM donaciones d
      LEFT JOIN donantes don ON d.id_donante = don.id_donante
      LEFT JOIN categorias c ON d.id_categoria = c.id_categoria
      LEFT JOIN usuarios u ON d.id_usuario = u.id_usuario
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error al cargar donaciones:', err);
    res.status(500).json({ error: err.message });
  }
});

// Rutas protegidas
app.use('/api/campanas', require('./routes/campanasRoutes'));

app.use('/api/donantes', require('./routes/donantesRoutes'));

app.use('/api/donaciones', require('./routes/donacionesRoutes'));

app.use('/api/paquetes', require('./routes/paquetesRoutes'));

app.use('/api/beneficiarios', require('./routes/beneficiariosRoutes'));

app.use('/api/distritos', require('./routes/ubicacionRoutes'));

app.use('/api/entregas', require('./routes/entregasRoutes'));

app.use('/api/usuarios', require('./routes/usuariosRoutes'));

app.use('/api/tareas', require('./routes/tareasRoutes'));

app.use('/api/testimonios', require('./routes/testimoniosRoutes'));


app.use('/api/dashboard', require('./routes/dashboardRoutes'));

app.use('/api/excel', require('./routes/excelRoutes'));
// Ruta por defecto para errores 404
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// Manejo de errores global
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

app.get("/", (req, res) => {
  res.send("🚀 Backend funcionando en Railway");
});


// Iniciar servidor
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Backend corriendo en el puerto ${PORT}`);
});











