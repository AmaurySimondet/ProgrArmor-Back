import React from "react";

function CategorieHiddenText() {
    return (
        <div className="hidden-text">
            <strong> Comment comprendre les categories sur ProgrArmor ? </strong> <br />
            <br />
            Les categories sur ProgrArmor permettent de caractériser au mieux vos exercices, de les différencier et de les suivre. <br />
            {"Nous avons fait le parti pris de réduire au minimum le nombre d'exercices mais de multiplier les catégories / variantes."} <br />
            {"Nous tentons ainsi d'inclure toutes les communautés sportives dans leur diversité de manière compréhensible pour tous."} <br />
            <br />
            <strong> Ok mais concrètement ça veut dire quoi ? </strong> <br />
            <br />
            {"Un exemple vaut mille mot:"} <br />
            {"Si je note dans mon cahier d'entraînement: ' Curl: 12kg 4*12 reps '"} <br />
            {"Quel exercice ai-je réalisé et comment ?"} <br />
            Si vous vous croyez malin vous allez surement me dire du curl, et je ne peux pas dire que vous ayez tord <br />
            {"Mais qui vous dis que j'ai réalisé l'exercice debout et pas sur un banc incliné à 45° ? Etait-ce un leg curl et pas un biceps curl ?"} <br />
            {"Avec des haltères ou barre EZ ? En prise neutre ou même en rotation ? En m'arrêtant ou en faisant une pause à la parallèle ?"} <br />
            {"En y ajoutant des élastiques ? Un curl Zanetti ou peut être sur pupitre ? En unilatéral ? Stricte ?... "} <br />
            <br />
            <i> Toutes les catégories sont combinables et multipliables </i><br />
            <br />
            <strong> {"Mais c'est compliqué tout ça !"} </strong> <br />
            <br />
            {"Vous pouvez tout à fait garder une notation telle que ' Curl: 12kg 4*12 reps ' tant que vous vous comprenez."} <br />
            {"Sachez en tout cas que ces outils seront là le jour où vous en aurez besoin."} <br />
            {"Un problème de temps ? ProgrArmor a mis tout en oeuvre pour faciliter votre prise de note avec ses outils."} <br />
            {"Un problème de place ? ProgrArmor c'est une page infinie sans aucune marge, ecrivez, effacez, modifiez autant que vous voulez."} <br />
            <br />
            <strong> ProgrArmor : Tout ce dont vous avez besoin </strong> <br />
            <br />
            Le but de ProgrArmor va bien au delà de celui du cahier: <br />
            Il vous permet de savoir où, quand, comment, dans quels conditions... vous avez réaliser tel ou tel exercice le tout retrouvable en quelques clics. <br />
            Vous beneficez aussi de statistiques enrichissantes sur votre pratique et pouvez suivre la progression de vos amis. <br />
            {"Essayez, c'est gratuit !"} <br />
            <br />
            <i> {"Cliques à nouveau sur l'icône"} <img className="myDIV" src={require('../../../images/icons/icons8-question-mark-96.webp')} alt="?" /> {"pour faire disparaître ce bandeau d'information"} </i>
        </div>
    )
}

module.exports = CategorieHiddenText;