# Scrutiny

[Scrutiny](https://github.com/AnalogJ/scrutiny) surveille la santé de vos disques durs et SSD : son
collecteur lit leurs données S.M.A.R.T. (en général une fois par jour) et son tableau de bord web
indique quel disque va bien, lequel montre un avertissement et lequel est en échec, avec des seuils
tirés de taux de panne réels. Cette intégration amène ce tableau de bord dans Gladys : chaque disque
devient un appareil avec sa santé, sa température et ses compteurs, des scènes réagissent quand un
disque passe en échec, redevient OK ou n'est plus collecté, et un widget liste d'abord les disques
qui demandent votre attention.

Gladys lit le serveur web de Scrutiny : elle ne touche jamais à vos disques. Tout reste sur votre
réseau (aucun cloud).

Testée contre un vrai Scrutiny en Docker (v0.9.5, image omnibus), alimenté par de vraies sorties
`smartctl` de la suite de tests de Scrutiny : disques sains, en avertissement, en échec S.M.A.R.T. et
Scrutiny, un disque NVMe, une collecte trop ancienne. Pas encore sur une installation réelle : vos
retours sont les bienvenus dans [les issues](https://github.com/guim31/gladys-scrutiny/issues).

## Ce qu'il vous faut

- Gladys Assistant 5.1.0 ou plus récent.
- Un serveur web Scrutiny (image `omnibus`, ou `web` + InfluxDB) joignable depuis Gladys, en général
  sur le port 8080, avec au moins un collecteur qui lui envoie des données. Scrutiny v0.8 et v0.9
  sont pris en charge.
- Si un proxy inverse demande une connexion devant Scrutiny : son utilisateur et son mot de passe
  (authentification basique). Scrutiny lui-même n'a pas de connexion.

## Mise en route

### 1. Trouver l'adresse de Scrutiny

C'est l'adresse de son tableau de bord, par exemple `http://192.168.1.2:8080`. Une adresse copiée
depuis le navigateur convient aussi (`…/web/dashboard`) : l'intégration garde la partie serveur.
Derrière un proxy inverse avec un sous-chemin (réglage `basepath` de Scrutiny), saisissez l'adresse
avec ce sous-chemin.

### 2. Configurer l'intégration

Dans Gladys, ouvrez **Intégrations → Scrutiny → Configuration** :

- **Adresse de Scrutiny** : l'adresse trouvée ci-dessus.
- **Utilisateur du proxy (facultatif)** et **Mot de passe du proxy (facultatif)** : seulement si un
  proxy inverse les demande.
- **Intervalle de rafraîchissement** : à quelle fréquence Scrutiny est lu, 15 minutes par défaut. Une
  requête pour la liste des disques et une pour les réglages à chaque fois ; les attributs d'un
  disque ne sont relus qu'après une nouvelle collecte.
- **Collecte trop ancienne après** : au bout de combien de temps sans nouvelle collecte un disque
  déclenche « Disque plus collecté » (36 heures par défaut, pour un collecteur quotidien).
- **Langue des noms** : la langue des noms de fonctionnalités (figés à l'ajout d'un appareil) et des
  textes envoyés aux scènes.

Cliquez ensuite sur **Tester la connexion** : elle indique combien de disques Scrutiny suit, et
combien sont en échec.

### 3. Ajouter les disques

Ouvrez l'onglet **Découverte** de l'intégration et ajoutez les disques à suivre, ainsi que l'appareil
**Scrutiny** si vous voulez les totaux. Les disques archivés dans Scrutiny ne sont pas proposés. Un
disque est identifié par son WWN (son identifiant Scrutiny quand il n'en a pas, comme certains
disques NVMe) : le changer de port ou de machine garde le même appareil.

## Les appareils

Chaque disque a ces fonctionnalités :

- **Disque en échec** : oui quand Scrutiny marque le disque en échec, comme le fait son tableau de
  bord (le « seuil de statut » des réglages de Scrutiny : S.M.A.R.T., Scrutiny ou les deux). La
  condition à utiliser dans les scènes.
- **Santé** : OK, Avertissement (le disque passe mais un attribut est douteux) ou En échec, en texte.
- **Température** : à la dernière collecte, en °C.
- **Heures de fonctionnement** : telles que le disque les donne.
- **Secteurs réalloués** et **Secteurs en attente** : attributs S.M.A.R.T. 5 et 197, seulement sur
  les disques qui les donnent (SATA). Un compteur qui grimpe est le premier signe d'un disque qui
  lâche.
- **Depuis la dernière collecte** : heures depuis le dernier envoi du collecteur pour ce disque.

L'appareil **Scrutiny** compte les **Disques en échec**, les **Disques en avertissement** et les
**Disques au total**.

## Tableau de bord

Le widget **Disques Scrutiny** affiche trois tuiles (en échec, avertissements, la température la plus
haute), puis une ligne par disque : ceux en échec d'abord, puis les avertissements, les disques plus
collectés et les disques sains, dix lignes au plus. Choisissez des disques dans ses réglages pour
n'afficher qu'eux. **Actualiser** relit Scrutiny.

## Scènes

### Déclencheurs

- **Un disque passe en échec** : Scrutiny marque un disque en échec après une collecte. Variables :
  le nom du disque, son modèle, les attributs en échec et sa température.
- **Un disque redevient OK** : un disque en échec repasse au vert à une nouvelle collecte, ou après un
  changement du seuil de Scrutiny. Variables : le nom du disque, son modèle et le nombre d'heures en
  échec.
- **Disque plus collecté** : plus de collecte pour un disque depuis le délai de la configuration
  (collecteur arrêté, disque disparu). Un événement par disque. Variables : le nom du disque, son
  modèle et les heures depuis sa dernière collecte.

Chaque déclencheur peut se limiter à certains disques. Un disque vu pour la première fois ne
déclenche rien : un disque en échec depuis des mois n'est pas une nouvelle. L'intégration garde le
dernier état de chaque disque : un disque passé en échec pendant un redémarrage de Gladys ou de
l'intégration est quand même annoncé, une fois.

### Actions

- **État d'un disque** : lit un disque pour les actions suivantes : en échec ou non, sa santé, son
  nom, son modèle, sa température, ses heures de fonctionnement, les heures depuis la collecte, les
  attributs en cause, et une phrase toute prête comme « Samsung SSD 840 (sdd) : En échec, 33 °C,
  collecté il y a 5 jours. UltraDMA CRC Error Count. »
- **Compter les disques en échec** : compte les disques en échec, en avertissement, plus collectés et
  au total, et nomme ceux en échec, pour un bilan.

Les deux relisent Scrutiny quand la dernière lecture date de plus d'une minute.

### Idées de scènes

- **Un disque passe en échec** → envoyer sur Telegram « Disque {disque} en échec : {attributs} », et
  allumer une lampe en rouge.
- Chaque dimanche à 10 h → **Compter les disques en échec** → si le nombre dépasse 0, envoyer
  « {noms} en échec, {avertissements} disque(s) en avertissement ».
- **Disque plus collecté** → prévenir « Le collecteur Scrutiny de {disque} s'est arrêté il y a
  {heures} heures » : un NAS de sauvegarde qui ne s'est pas réveillé, un conteneur de collecteur
  planté.

## Dépannage

- **« Scrutiny ne répond pas »** : vérifiez l'adresse et le port depuis la machine de Gladys, et
  qu'un pare-feu ne bloque pas.
- **« Scrutiny répond en erreur »** : sa base de données (InfluxDB) est arrêtée ou pleine ; le
  tableau de bord de Scrutiny montre la même erreur.
- **« Une connexion est demandée »** : un proxy inverse protège Scrutiny ; renseignez son
  utilisateur et son mot de passe (authentification basique seulement).
- **« L'adresse redirige »** : saisissez directement l'adresse en `https://`.
- **« Certificat refusé »** : un certificat auto-signé n'est pas accepté ; utilisez l'adresse
  `http://` sur votre réseau.
- **Aucun disque** : aucun collecteur n'a encore envoyé de données ; lancez-le une fois
  (`docker exec scrutiny scrutiny-collector-metrics run` avec l'image omnibus).
- **Un disque reste « Pas encore collecté »** : il est enregistré mais son collecteur n'a pas pu lire
  ses données S.M.A.R.T. (boîtier USB, contrôleur RAID) : voir les logs du collecteur.
- **La santé diffère du tableau de bord de Scrutiny** : rechargez le tableau de bord ; l'intégration
  lit le même seuil de statut, à l'intervalle choisi.

## Limites

- Les données sont celles de la dernière collecte : avec le collecteur quotidien par défaut, un
  disque qui lâche à midi apparaît à la collecte suivante.
- L'historique de Scrutiny, ses notifications et les résultats d'autotests ne sont pas lus ;
  l'historique de chaque fonctionnalité est gardé par Gladys.
- Les compteurs de secteurs n'existent que pour les disques SATA ; les disques NVMe et SAS montrent
  leur santé, leur température et leurs heures.
- Sans lien avec Scrutiny ni son auteur.
