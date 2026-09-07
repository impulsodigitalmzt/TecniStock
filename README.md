# TecniStock

Vendedor de mostrador 24/7 para ferretería, electricidad y plomería.

1. El técnico fotografía la pieza.
2. Groq visión describe lo que se ve.
3. El anaquel sale solo de Neon `inventario_local`.
4. El chat arma el pedido o el apartado con ese snapshot.

## Arranque

```bash
cp .env.example .dev.vars
npm install
npm run build:vite --prefix frontend
npm run dev
```

Secretos de producción: `DATABASE_URL` y `GROQ_API_KEY` (`npx wrangler secret put …`).
