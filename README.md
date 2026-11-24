# QA Talent Onboarding

Onboarding de testers creado con React, TypeScript, Vite y Supabase. Incluye preguntas condicionales, un ejercicio práctico con defectos intencionales, resultados y un panel protegido de administración.

## Desarrollo

```sh
npm install
copy .env.example .env.local
npm run dev
```

Sin variables de Supabase, la app queda en modo de vista previa y conserva solicitudes en el almacenamiento local del navegador. Para persistencia compartida y administración, configura el proyecto siguiendo los pasos de abajo.

## Configurar Supabase

1. Copia la URL y la clave publicable (o anon heredada) del proyecto a `.env.local` como `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
2. Inicia sesión en Supabase CLI con `npx supabase login`, vincula este proyecto con `npx supabase link --project-ref <PROJECT_REF>` y aplica el esquema con `npx supabase db push`.
3. Configura `SUPABASE_SERVICE_ROLE_KEY` como secreto de Supabase Functions; nunca lo pongas en `.env.local` ni en variables `VITE_`.
4. Despliega la función pública de recepción con `npx supabase functions deploy onboarding-intake`.
5. Crea la cuenta de administración en Supabase Auth y marca `app_metadata.role` con el valor `admin`; RLS solo permite leer resultados a sesiones con ese claim. El panel envía un código de un solo uso al correo y lo valida directamente, sin contraseña compartida. En Authentication → Email Templates → Magic Link, incluye `{{ .Token }}` en el contenido del correo para que el código de seis dígitos sea visible. `signInWithOtp` usa ese mismo correo; si la plantilla solo muestra `{{ .ConfirmationURL }}`, se recibe un enlace en lugar del código.

La tabla `public.tester_applications` tiene RLS habilitado. La función de recepción valida un token aleatorio por solicitud antes de guardar respuestas, y calcula el puntaje y las etiquetas en el servidor.

## Alcance de los controles de foco

La aplicación registra pérdida de foco/cambio de pestaña y advierte en el primer evento; el segundo evento cancela la solicitud. El navegador no permite que una página web bloquee de forma fiable extensiones, DevTools o el cierre de una pestaña. `beforeunload` solo muestra la advertencia nativa del navegador.
