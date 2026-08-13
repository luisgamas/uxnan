# 02g — Hosts remotos por SSH

> **Estado:** en construccion. Lo implementado se marca como tal en cada seccion;
> el resto es la direccion acordada, no codigo existente.
> Identidad de destino y fencing: ver [`02a`](02a-system-architecture.md) §2.9.

---

## 1. El modelo: UI local, ejecucion remota

Un **host remoto** es otra maquina del usuario a la que el ADE se conecta por
SSH. El trabajo ocurre **alli**: los agentes corren en el host, con los CLIs que
ese host tiene instalados y con las credenciales de ese host. El ADE es la
superficie de control.

```
Maquina del usuario                        Host remoto
+----------------------------+            +------------------------------+
| uxnandesktop               |            | shell, git, node             |
|  shell de tres paneles     |    SSH     | CLIs de agente instalados    |
|  terminal (xterm.js)       |<--------- >| el codigo del proyecto       |
|  paneles git / archivos    |  1 conexion| los procesos que arranca el  |
|  navegador integrado       |  N canales | agente (dev server, tests)   |
+----------------------------+            +------------------------------+
```

**La alternativa descartada** —agente local contra un filesystem remoto
montado— no se implementa: la herramienta Bash del agente ejecutaria build,
tests y git **en la maquina del usuario** contra un montaje de red, que es lo
contrario de la razon por la que alguien se conecta a una maquina mas potente.
Ademas, un turno de agente lee cientos de archivos y cada `stat` seria un viaje.

## 2. Clase de confianza

Un host SSH es **"mi maquina, mi cuenta"**: una sesion vale exactamente lo que
vale la shell de ese usuario. Esta capa **no** promete un techo de permisos
impuesto desde el otro lado — eso es un diseno distinto (un worker propio con
capacidades acotadas) y fingirlo en la interfaz seria mentir.

Lo que si se garantiza es que el trabajo aterriza en la maquina que el usuario
quiso: el fencing de mutaciones de `02a` §2.9.

## 3. Secretos: ninguno se guarda

El registro de un host guarda alias, hostname, puerto, usuario y una
**referencia** a un fichero de identidad. Nunca una llave, nunca una contrasena.
Los aportan el agente SSH del sistema, el fichero de llave en disco y, si hace
falta, un prompt que vive solo en memoria durante la sesion.

`ForwardAgent` es la pieza que evita copiar nada: permite que git **en el host**
use las llaves que sostiene el agente **aqui**, sin que una llave privada salga
de esta maquina.

## 4. Configuracion SSH del usuario — IMPLEMENTADO

Dos trabajos separados, con exigencias muy distintas
(`src-tauri/src/ssh/config.rs`):

| Trabajo | Como | Por que asi |
|---|---|---|
| **Enumerar** alias (`Host`, siguiendo `Include`) | escaneo propio que entiende exactamente dos palabras clave | solo hacen falta candidatos para un selector; los patrones con comodin (`Host *`) se saltan porque son valores por defecto, no hosts |
| **Resolver** un alias a sus valores efectivos | `ssh -G <alias>` | reimplementar la precedencia de OpenSSH (`Match`, orden de patrones, canonicalizacion) es como acabar conectando a un sitio distinto del que conectaria el `ssh` del propio usuario. `ssh -G` viene con Windows, macOS y Linux |

Detalles que el escaneo cubre: ambos separadores (`Host x` y `Host=x`), varios
alias por linea, comentarios, `Include` relativo/absoluto/con `~` y con globs,
ciclos de `Include` (limite de profundidad + visitados), duplicados (gana la
primera aparicion, igual que el first-match-wins de OpenSSH) y un tope de
resultados. Un fichero ausente es una lista vacia, no un error.

Del `ssh -G` se levantan solo los campos sobre los que el ADE actua; el literal
`none` que OpenSSH imprime para `proxycommand` / `proxyjump` / `identityagent`
se trata como "sin valor" (ejecutar un comando llamado `none` seria un fallo
desconcertante en el momento de conectar).

Comandos: `ssh_config_hosts` y `ssh_config_resolve`. Ambos de solo lectura y sin
conexion alguna.

## 5. Transporte — decidido, no implementado

- **Cliente en proceso, una conexion y N canales.** El cliente OpenSSH de
  Windows no implementa `ControlMaster`, asi que lanzar `ssh.exe` por operacion
  significaria un handshake completo por comando. Prohibido.
- **`ssh` del sistema como plan B declarado por host**, para los casos que un
  cliente en proceso no cubre (GSSAPI, ciertos `ProxyCommand`), anunciando que
  capacidades se pierden en ese modo.
- **Verificacion de host obligatoria** contra `known_hosts`, con confirmacion
  explicita de huella desconocida y error —nunca "continuar"— ante una huella
  cambiada. No existe modo "ignorar host key".

## 6. Que funciona y que no en un contexto remoto

| Capa de estado de agente (`02d`) | Remoto |
|---|---|
| Capa 2 — titulo / OSC | **Funciona sin trabajo extra**: viaja en el stream de bytes del PTY |
| Capa 1 — hooks HTTP | Requiere tunel inverso + instalar los reporters en el host. Fase posterior |
| Capa 3 — deteccion de proceso | Requiere sondeo remoto de procesos. Fase posterior |

Regla de honestidad para la interfaz: lo que no se puede medir en remoto se
marca **"no disponible en este entorno"**. Jamas se rellena con el dato local.

## 7. Fases

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Identidad de destino y fencing (`02a` §2.9) | **Hecho** |
| 1 | Registro de hosts, conexion, inventario, PTY remota, lanzador | **En curso** — configuracion SSH hecha |
| 2 | Estado preciso (tunel inverso + reporters remotos) | Pendiente |
| 3 | Archivos, git y worktrees remotos | Pendiente |
| 4 | Puertos detectados, forward y vista previa en el navegador integrado | Pendiente |
| 5 | Continuidad y recursos remotos | Pendiente |
| 6 | Que el movil vea tambien los destinos (solo contrato aditivo) | Pendiente |

## 8. Fuera de alcance (con motivo)

- **Contenedores y devcontainers.** Un entorno declarado por el usuario que
  imprima un destino SSH entra por la misma puerta que un host; no hace falta
  arquitectura nueva para ello.
- **Sandboxes.** Cada CLI de agente trae el suyo o ninguno (y en Windows nativo
  casi ninguno aplica), asi que el ADE no puede prometer un aislamiento
  uniforme sin mentir. Lo que si puede es exponer y explicar el de cada agente.
