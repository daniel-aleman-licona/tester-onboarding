# QA Talent Onboarding

Evaluación de testers con React, TypeScript, Vite y Supabase. Una evaluación incluye preguntas de perfil, un reto práctico y un resultado calculado en Supabase. El admin gestiona el cuestionario y consulta las solicitudes, respuestas y hallazgos.

## Desarrollo

1. Instala las dependencias con `npm ci`.
2. Copia `.env.example` a `.env.local`. Configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` con los valores del proyecto. También se admite la variable anterior `VITE_SUPABASE_ANON_KEY`.
3. Ejecuta `npm run dev`. Si quieres un demo local sin Supabase, activa `VITE_ONBOARDING_DEMO=true`. El demo solo está disponible en el servidor de desarrollo y guarda en ese navegador.

## Supabase

- Aplica las migraciones en orden y publica `onboarding-intake` con `verify_jwt = false`. Las solicitudes públicas usan un token aleatorio por evaluación y las acciones de administración comprueban el rol con Supabase Auth. La clave de servicio se lee del entorno de Edge Functions.
- En Authentication → Email Templates → Magic Link, aplica `supabase/templates/magic-link.html`. En el proveedor Email, verifica que el código tenga seis dígitos. Comprueba el envío al buzón autorizado y configura SMTP cuando el proveedor predeterminado no pueda entregarlo.
- Usa una cuenta verificada de Supabase Auth y asigna el rol `admin` en sus metadatos de aplicación, conservando los demás campos. Tras cambiar el rol, cierra la sesión anterior y entra de nuevo desde `/#admin`.

## Vercel

Configura un proyecto Vite vinculado al repositorio. Define `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` en Preview y Production. El build valida la configuración. La clave de servicio solo se usa en Supabase.

Aplica las migraciones, publica la función y verifica el flujo desde Preview antes de publicar la versión en el dominio de producción.

## Cambios en el cuestionario

En Admin → Preguntas, publica los cambios cuando estén listos. Cada solicitud conserva la versión vigente cuando empezó. Experiencia, Habilidades y las preguntas condicionales conservan sus reglas de perfil.

## Controles de foco

La aplicación registra cambios de ventana o pestaña durante la evaluación. El primer cambio genera un aviso y el segundo cancela la solicitud. La página depende de las señales que el navegador permite observar.
