# pi-opencode-go-usage

[![npm version](https://img.shields.io/npm/v/pi-opencode-go-usage?color=cb0000)](https://www.npmjs.com/package/pi-opencode-go-usage) [![pi package](https://img.shields.io/badge/pi-package-7a5cff)](https://pi.dev/packages/pi-opencode-go-usage) [![license MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

**[Galego](README.gl.md) · English**

Sigue en sesión os límites de uso de OpenCode Go — **de 5 horas (xanela móbil), semanais e mensuais** — cunha barra de estado en directo e un widget de informe `/opencode-go`.
![Status bar showing OpenCode Go usage](assets/pi-opencode-go-usage.png)

```
Status bar:  Go 5h 62% · wk 31% · mo 44%

Report widget:
  OpenCode Go Usage
  Rolling 5h ██████░░░░  62% · 1h 12m
  Weekly     ███░░░░░░░  31% · 3d 4h
  Monthly    ████░░░░░░  44% · 12d 0h
  Updated 2:32:05 PM  (time format follows your locale)
```

## Por que existe

OpenCode Go expón o uso directamente a través da API ZEN cunha clave da API:

```
GET https://opencode.ai/zen/go/v1/usage     (Authorization: Bearer <api-key>)
-> { usage: {
      rolling: { status, percent, resetsAt },
      weekly:  { status, percent, resetsAt },
      monthly: { status, percent, resetsAt } } }
```

Esta extensión chama a ese endpoint coa túa clave da API de Go e le as tres porcentaxes (`percent` xa é un número de 0 a 100) xunto coas contas atrás de restablecemento — cada xanela leva o seu propio `resetsAt`. Informa **só de porcentaxes e contas atrás** — non gasta espazo de pantalla en cifras en dólares.

## Instalación

```bash
pi install npm:pi-opencode-go-usage   # Pi (recommended)
# or
omp plugin install github:Dakai/pi-opencode-go-usage
# or, for local dev:
omp plugin link /path/to/pi-opencode-go-usage
```

Despois reinicia a sesión (ou `/reload`).

## Conectar

Necesitas unha **clave da API de OpenCode Go** da túa conta con sesión iniciada en opencode.ai (a clave da API emitida para o produto Go; os valores de variable de ambiente e de ficheiro gardado envíanse como `Authorization: Bearer <api-key>`).

Establece a variable de ambiente (recomendado — mantén a clave fóra do historial da sesión):

```bash
export OPENCODE_GO_API_KEY='…'
```

ou usa o comando de barra (gárdase en `~/.omp/agent/opencode-go-usage.json`, modo 0600):

```
/opencode-go --connect <api-key>
```

As variables de ambiente **teñen prioridade** sobre o ficheiro gardado: mentres `OPENCODE_GO_API_KEY` estea definida, `--connect` / `--key` gárdana pero non teñen efecto (o comando avisa cando o detecta). Desactívaa ou exporta o novo valor. `OPENCODE_GO_CONFIG_PATH` substitúe a localización do ficheiro (por defecto `~/.omp/agent/opencode-go-usage.json`).

## Comandos

| Comando                                | Efecto                                                        |
| --------------------------------------- | ------------------------------------------------------------- |
| `/opencode-go`                          | Obtén os datos e amosa o widget de informe                    |
| `/opencode-go --connect <api-key>`      | Garda a clave, obtén os datos e amosa (alias `--setup`)       |
| `/opencode-go --key <value>`            | Garda só a clave (alias `--api-key`)                          |
| `/opencode-go --disconnect`             | Esquece a clave                                               |
| `/opencode-go --refresh`                | Obtén os datos de novo agora                                  |
| `/opencode-go --compact [on\|off]`      | Alterna a barra de estado compacta (`Go: 5h 0% · wk 2% · mo 2%`) |
| `/opencode-go --json`                   | Exporta o informe a `~/.omp/agent/opencode-go-usage-report.json` |

O uso actualízase automaticamente cada 5 minutos.

## Modos de fallo

| Texto de estado                         | Significado                        | Solución                                         |
| ------------------------------------- | ------------------------------ | ----------------------------------------------- |
| `Invalid API key`                     | A API ZEN rexeitou a clave     | Actualiza `OPENCODE_GO_API_KEY` ou volve executar `/opencode-go --connect <api-key>` |
| `No Go subscription on this account`  | A conta non ten ningún plan de Go | Revisa a conta                                 |
| `ZEN API response unrecognised`       | A API ZEN cambiou de formato   | Actualiza o analizador                         |
| `Network error` / `Request timed out` | Transitorio                    | Reintenta                                      |

## Seguridade

Esta é unha lectura autenticada das túas propias cifras de uso, cunha clave da API de Go almacenada nun ficheiro en modo `0600` (ou nunha variable de ambiente). Informa só do que a API xa expón; un cambio na API romperíaa, e diríao en lugar de amosar un cero confiado.

## Licenza

MIT