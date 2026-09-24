# Mapa De Supermemento

## 1. Integracion Y Estado

main integra mediante PR. Dominio ZKTeco, control Linux; contrato en
[DEPLOYMENT_CONTROL.json](DEPLOYMENT_CONTROL.json). GitHub Issues guarda el
trabajo pendiente. Verificar version real al operar; este mapa no acredita runtime.

## 4. Despliegue

VPS: n8n_supermemento, n8n_supermemento-chatgpt, n8n_neo4j.
Procedimiento y reglas MEM: [MEMORY_POLICY.md](MEMORY_POLICY.md).
Gateway/OAuth: [CHATGPT_MCP_GATEWAY.md](CHATGPT_MCP_GATEWAY.md).
Evidencia nueva una vez en issue/PR, sin registro de rollout duplicado.

## 5. Limites Y Referencias

Aislamiento containerTag, vigencia y reparacion reversible se conservan.
Nunca escribir pruebas en memorias de produccion ni copiar secretos.
[Estado anterior](STATE-before-2026-09-24.md) conserva todos los hechos y
referencias fechados. Consultar solo el apartado necesario; no es procedimiento
vigente ni prueba del estado actual. Solo actualizar este mapa por hechos duraderos.
