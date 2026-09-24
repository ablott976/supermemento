# Supermemento

Procedimiento comun: ~/.config/ancora/VERIFICACION-PROPORCIONAL.md, una vez.
Linux/Mac, Codex/Claude: contexto por impacto, evidencia unica en issue/PR,
sin diario, lecturas generales ni informe adicional. Completar el alcance
autorizado; no pedir otra vez permisos ya dados. STATE es un mapa.

## Producto Y Limites

MCP Node/TypeScript en src/, Neo4j y gateway Python en chatgpt_gateway/.
main es integracion y fuente de imagen; cambios mediante PR.
Dominio ZKTeco, control Linux. Runtime VPS: n8n_supermemento,
n8n_supermemento-chatgpt y n8n_neo4j. Backend por git archive, SSH,
docker build y actualizacion dirigida del servicio, no build de EasyPanel.
Consultar docs/DEPLOYMENT_CONTROL.json y despliegue en docs/MEMORY_POLICY.md
solo al operar. Gateway se redespliega solo cuando le afecta el cambio.

Neo4j es el almacen; esquema en src/schema/. containerTag aisla memorias;
zkteco-pmm es el contexto PMM, no un gestor de tareas. Cambios de contratos,
temporal_class/validTo, deduplicacion o vigencia conservan MEM-01..MEM-05
de docs/MEMORY_POLICY.md; documentar decisiones nuevas, no otro diario.
Reparaciones de historia: informe primero, aplicacion autorizada y reversible,
runId y restauracion en ~/backups/supermemento/ del VPS. Esquema/repair/token
no se modifican incidentalmente. Pruebas de escritura: chatgpt-mcp-canary,
nunca contenedores de datos productivos. OAuth, tokens/digests y claves fuera
de Git/logs. No nuevos temporizadores; unidades existentes en deploy/.

## Verificacion Y Referencias

Comandos disponibles: npm run typecheck, npm run lint, npm test, npm run build;
gateway: pytest tests/ con fastmcp. Seleccionar por impacto y controles reales
del repo; documentacion inerte no requiere bateria de aplicacion ni despliegue.
Tras rollout: revision de imagen, convergencia, arranque limpio, health/ready,
rechazo MCP no autenticado y initialize -> tools/call del flujo afectado.
No confundir salud con aceptacion funcional; evidencia una vez en issue/PR.
OAuth/MCP: docs/CHATGPT_MCP_GATEWAY.md y docs/MCP_CLIENT_COMPATIBILITY.md.
Relay Codex: docs/OPENAI_CODEX_OAUTH.md, docs/OPENAI_CODEX_SUBSCRIPTION.md,
deploy/. Arquitectura: README.md, docs/SPEC.md (n8n historico, no reinstalar).
