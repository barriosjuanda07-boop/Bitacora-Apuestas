# Bitácora de Apuestas

Registro personal de apuestas deportivas. Escribes el partido, tu apuesta, la cuota y el monto; la página calcula la ganancia posible y, cuando marcas el resultado, actualiza balance, ROI, acierto, rachas, caída máxima y desgloses por deporte y casa.

**Página:** https://barriosjuanda07-boop.github.io/Bitacora-Apuestas/

## Uso

- **+ Nueva apuesta** (o la tecla **N**): elige **Simple** (partido, tu apuesta —por ejemplo "Alcaraz −1.5 sets"—, cuota y monto) o **Combinada** (agrega las selecciones que quieras; si llenas la cuota de cada una, la cuota total se calcula sola).
- En el historial, las pendientes tienen botones **Ganó / Perdió**. Para nula, cash out, medio ganada o medio perdida, usa **Editar**.
- **Ajustes:** bankroll inicial, moneda, valor de una unidad, descarga de CSV y respaldo JSON, e importación.

## Dónde se guardan los datos

Sin configurar nada, en el navegador donde abres la página: cada dispositivo tiene su propio historial. Descarga un respaldo de vez en cuando desde Ajustes.

### Sincronizar celular y computadora (Firebase, opcional)

1. https://console.firebase.google.com → **Crear un proyecto** (puedes desactivar Google Analytics).
2. **Authentication → Comenzar → Google → Habilitar** → Guardar.
3. **Authentication → Configuración → Dominios autorizados → Agregar dominio:** `barriosjuanda07-boop.github.io`
4. **Firestore Database → Crear base de datos → Modo de producción**.
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

6. **Configuración del proyecto → Tus apps → Web (`</>`)** → registra la app → copia `firebaseConfig`.
7. Pégalo en `config.js` en lugar del `null`.

La `apiKey` de Firebase no es secreta; tus datos los protegen las reglas del paso 5.

## Archivos

- `index.html`: estructura y estilos.
- `app.js`: lógica de la página y almacenamiento.
- `settle.js`: cálculo de ganancia/pérdida.
- `config.js`: configuración de Firebase.
