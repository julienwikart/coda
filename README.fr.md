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
| `/coda:patterns` | Ce qui se répète, lu dans ce qui s'est réellement passé ; ignorer, corriger ou expérimenter. |
| `/coda:sync` | Sert-on toujours l'intention ? Lu dans la mémoire et le journal. |
| `/coda:audit` | Les éléments pour l'Ethical Guardian. |
| `/coda:autonomy` | Élargir ou réduire l'autonomie des agents, sur la foi du journal. |
| `/coda:status` | Où en est l'équipe, et si le harness est réellement en place. |
| `/coda:org` | Plusieurs équipes : l'intention de l'organisation, la carte de qui porte quoi, les planchers de chaque harness. |
| `/coda:arbitrate` | Régler ce que deux équipes ne peuvent pas régler entre elles ; un humain nommé décide. |
| `/coda:overview` | L'organisation d'un coup d'œil : périmètres portés, ce qui est ouvert entre équipes. |
| `/coda:split` | Faire d'une équipe plusieurs sandwich teams, chacune avec ce dont elle hérite. |

Les commandes ne sont pas nécessaires pour que le harness agisse : dès que `.coda/` existe, toute session dans le projet reçoit le brief, les garde-fous, le journal et le portail de vérification.

## Plusieurs équipes

Des équipes de deux, c'est plus d'équipes, et ce qui les relie compte davantage que ce qui se passe dans chacune. Une organisation est un dossier `.coda-org/` partagé par les équipes, dans le même dépôt ou dans un dépôt à part que chaque équipe lit depuis une copie locale. `/coda:org` la met en place. Une fois qu'elle existe :

- **Une intention au-dessus des équipes.** Les contraintes de l'organisation arrivent dans chaque session de chaque équipe ; personne ne les recopie.
- **Une carte de qui porte quoi.** Chaque équipe déclare ses domaines et ses composants. Deux équipes qui revendiquent la même chose sont signalées aussitôt, et dans un dépôt partagé les agents d'une équipe ne peuvent pas écrire dans le dossier d'une autre.
- **Une mémoire qui traverse les équipes.** `/coda:recall` cherche dans les décisions de toutes les équipes ; chacune est prévenue des décisions prises ailleurs qui la concernent ; une contradiction entre deux équipes apparaît chez les deux. Les journaux restent dans chaque équipe.
- **L'arbitrage.** Ce que deux équipes ne peuvent pas régler est tranché une fois par un humain nommé (`/coda:arbitrate`) et s'impose aux équipes concernées.
- **Des planchers.** L'organisation fixe ce qu'aucun harness d'équipe ne peut affaiblir ; chaque équipe règle son niveau au-dessus.
- **L'ensemble d'un coup d'œil.** `/coda:overview` montre les périmètres portés, ce qui est ouvert entre équipes et les équipes qui disent être trop petites. Elle ne classe personne et ne compte pas les effectifs.
- **La scission.** `/coda:split` fait d'une équipe plusieurs sandwich teams, chacune avec son périmètre et les décisions qui la concernent.

Une équipe sans organisation fonctionne exactement comme avant.

## Niveaux d'autonomie

| Niveau | Agents d'exécution |
|---|---|
| `observed` | lisent et proposent ; les humains font chaque modification |
| `supervised` (par défaut) | agissent ; un humain approuve chaque modification et chaque commande |
| `bounded` | agissent librement dans un périmètre déclaré ; en dehors, ils demandent ; chemins protégés, jamais |

Une équipe gagne le niveau suivant avec les preuves de son propre journal, et un humain nommé enregistre le changement. Le journal, l'état de vérification et le niveau d'autonomie ne peuvent pas être écrits par le modèle.

## Le cadre

Le plugin est l'implémentation de référence d'un cadre, décrit dans [docs/framework.md](docs/framework.md) (en anglais) : la sandwich team, les trois étages, les quatre rôles, les conditions d'entrée, la trajectoire de huit à deux, ce que partagent plusieurs équipes. Voir aussi [le contrat de harness](docs/harness-contract.md) et [ce qui vient de SYNAPSE](docs/from-synapse.md).

Une position n'est pas négociable : à effectif égal, plus d'équipes et plus de périmètre. Les personnes libérées par une scission forment de nouvelles sandwich teams. La réduction d'effectifs n'est jamais un objectif du cadre.

## Licence

Code : MIT. Texte du cadre et documentation : CC BY-SA 4.0. Voir [LICENSE](LICENSE).
