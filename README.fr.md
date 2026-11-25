# CODA

**Deux humains, une intention, des agents qui livrent.**

CODA (Cognitive Orchestration for Delivery Agents) est un cadre pour porter un produit avec une *sandwich team* : deux humains qui le portent de bout en bout, avec des agents pour tout le reste. Il s'installe comme un plugin dans votre agent de code. Pas de serveur, pas de base de données, pas de clé d'API : votre agent est le runtime, votre dépôt est la mémoire.

[English](README.md)

## Installer

Dans Claude Code (terminal, VS Code, JetBrains ou application de bureau) :

```
/plugin marketplace add julienwikart/coda
/plugin install coda@coda
```

Puis, dans le projet concerné :

```
/coda:init
```

La commande demande qui compose l'équipe, ce qui doit passer avant qu'une livraison soit acceptée, et ce que les agents peuvent faire sans demander. Elle écrit un dossier `.coda/` à committer. Node 18 ou plus récent est nécessaire. Pour un autre agent ou un autre harness, voir [le contrat de harness](docs/harness-contract.md).

## Ce qui change une fois installé

Le harness est tout ce qui entoure le modèle dans un agent. CODA ne remplace pas le vôtre : il lui fait garantir cinq choses, sans lesquelles une équipe aussi petite ne peut pas déléguer.

| Couche | Ce que CODA fait faire au harness |
|---|---|
| Contexte et mémoire | Chaque session démarre avec le brief de l'équipe : l'intention, ses contraintes non négociables, les décisions en vigueur, les patterns ouverts. |
| Garde-fous | Le niveau d'autonomie est une permission, pas une consigne. Une écriture ou une commande hors du périmètre délégué est refusée ou soumise à un humain, quoi qu'on ait dit au modèle. |
| Boucles de vérification | Une session ne peut pas se terminer sur du code modifié tant que les commandes de vérification de l'équipe ne passent pas, ni, si vous l'exigez, tant qu'un agent vérifieur indépendant n'a pas revu cet état précis du dépôt. |
| Orchestration | Les agents cognitifs planifient et briefent, les agents d'exécution construisent. Un agent cognitif ne peut pas écrire de code ; un builder ne peut pas se valider lui-même. |
| Observabilité | Chaque run, écriture, commande, refus et vérification alimente un journal en ajout seul, chaîné par hash, dans le dépôt. |

Trois étages, chacun ne parlant qu'à son voisin : les humains portent l'intention, les agents cognitifs (memory, pattern, simulation, coordination) la traduisent en pilotage, les agents d'exécution (builder, verifier) livrent. Là où le SDD fait piloter par la spec, ici c'est la cognition qui pilote.

## Au quotidien

| Commande | Quand |
|---|---|
| `/coda:intent` | Écrire ou réviser ce pour quoi l'équipe existe, et ce qu'elle ne sacrifiera pas. |
| `/coda:deliver <demande>` | Construire : mémoire → plan et briefs → builders → vérification. |
| `/coda:decide <question>` | Un choix coûteux à défaire : mémoire, simulation, un humain décide, c'est enregistré. |
| `/coda:recall <question>` | « Qu'avions-nous décidé sur… ? » |
| `/coda:graph <sujet>` | Ce qui touche un composant, une contrainte, un risque ; comment les décisions dépendent les unes des autres ou se contredisent. |
| `/coda:patterns` | Ce qui se répète ; ignorer, corriger ou expérimenter. Remplace la rétrospective. |
| `/coda:sync` | Sert-on toujours l'intention ? Remplace le point d'avancement. |
| `/coda:audit` | Les éléments pour l'Ethical Guardian. |
| `/coda:autonomy` | Élargir ou réduire l'autonomie des agents, sur la foi du journal. |
| `/coda:status` | Où en est l'équipe, et si le harness est réellement en place. |
| `/coda:org` | Plusieurs équipes : l'intention et les contraintes de l'organisation, déclarées une fois et remises à chaque équipe. |

Les commandes ne sont pas nécessaires pour que le harness agisse : dès que `.coda/` existe, toute session dans le projet reçoit le brief, les garde-fous, le journal et le portail de vérification.

## Niveaux d'autonomie

| Niveau | Agents d'exécution |
|---|---|
| `observed` | lisent et proposent ; les humains font chaque modification |
| `supervised` (par défaut) | agissent ; un humain approuve chaque modification et chaque commande |
| `bounded` | agissent librement dans un périmètre déclaré ; en dehors, ils demandent ; chemins protégés, jamais |

Une équipe gagne le niveau suivant avec les preuves de son propre journal, et un humain nommé enregistre le changement. Le journal, l'état de vérification et le niveau d'autonomie ne peuvent pas être écrits par le modèle.

## Le cadre

Le plugin est l'implémentation de référence d'un cadre, décrit dans [docs/framework.md](docs/framework.md) (en anglais) : la sandwich team, les trois étages, les quatre rôles, les conditions d'entrée, la trajectoire de huit à deux, le niveau entreprise. Voir aussi [le contrat de harness](docs/harness-contract.md) et [ce qui vient de SYNAPSE](docs/from-synapse.md).

Une position n'est pas négociable : à effectif égal, plus d'équipes et plus de périmètre. Les personnes libérées par une scission forment de nouvelles sandwich teams. La réduction d'effectifs n'est jamais un objectif du cadre.

## Licence

Code : MIT. Texte du cadre et documentation : CC BY-SA 4.0. Voir [LICENSE](LICENSE).
