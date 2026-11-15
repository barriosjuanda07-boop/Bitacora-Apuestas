# Bitácora de Apuestas

Registro personal de apuestas deportivas: bankroll, ROI, acierto, rachas, caída máxima y desgloses por deporte y mercado. Busca partidos en ESPN y cierra sola las apuestas pendientes cuando termina el partido.

**Página:** https://barriosjuanda07-boop.github.io/Bitacora-Apuestas/

## Cómo funciona

- **Buscador de partidos:** al registrar una apuesta, escribe un equipo y elige el partido. Busca de 3 días atrás a 10 días adelante en las ligas activas (se eligen en Ajustes).
- **Cierre automático:** mientras la página está abierta revisa cada 3 minutos (y cada vez que vuelves a la pestaña) las apuestas pendientes vinculadas a un partido. Se cierran solos estos mercados:
  - Ganador (1X2 / moneyline), doble oportunidad, más/menos, hándicap/spread (incluye líneas asiáticas de cuarto: medio ganada / medio perdida) y ambos anotan.
  - Las apuestas de jugador, córners, tarjetas y combinadas se marcan a mano, pero el marcador final se guarda solo.
  - En fútbol, el marcador de ESPN de un partido de copa con prórroga incluye los goles del tiempo extra. Revisa esas apuestas si tu casa paga a 90 minutos.
- **Datos de ESPN:** es la API pública no oficial de ESPN (sin clave). Puede cambiar sin aviso; si deja de responder, la bitácora sigue funcionando y solo pierdes el buscador y el cierre automático.

## Activar la sincronización (Firebase)

Sin configurar, los datos se guardan solo en el navegador. Para tener el mismo historial en el celular y la compu:

1. Entra a https://console.firebase.google.com → **Crear un proyecto** (nombre: `bitacora-apuestas`, puedes desactivar Google Analytics).
2. **Authentication → Comenzar → Google → Habilitar** → elige tu correo de asistencia → Guardar.
3. **Authentication → Configuración → Dominios autorizados → Agregar dominio:** `barriosjuanda07-boop.github.io`
4. **Firestore Database → Crear base de datos** → ubicación `nam5` (o la más cercana) → **Modo de producción**.
5. En **Firestore → Reglas**, pega esto y publica:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```

6. **Configuración del proyecto (ícono de engrane) → Tus apps → Web (`</>`)** → registra la app → copia el objeto `firebaseConfig`.
7. Pega ese objeto en `config.js` (reemplazando el `null`), o mándaselo a Claude para que lo actualice.

La `apiKey` de Firebase no es secreta: identifica el proyecto. Lo que protege tus datos son las reglas del paso 5, que solo dejan leer y escribir a tu propia cuenta.

## Archivos

- `index.html`: estructura y estilos.
- `app.js`: lógica de la página, ESPN y almacenamiento.
- `settle.js`: cálculo de ganancias y liquidación de mercados (funciones puras).
- `config.js`: configuración de Firebase.
