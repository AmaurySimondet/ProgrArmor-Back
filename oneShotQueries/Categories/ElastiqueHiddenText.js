import React from "react";

function VarianteHiddenText() {
    return (
        <div className="hidden-text">
            <strong> Pourquoi estimer la tension de mon élastique ? </strong> <br />
            <br />
            {"Pour la traçabilité !  En effet, tout comme la charge, la tension d'un élastique permet de juger la force à l'instant t"} <br />
            Donc pour juger votre progression: jugez la tension utilisée de votre élastique au fil du temps ! <br />
            {"Cela est d'autant plus utile si vous ne vous entrainez pas toujours au même endroit, avec des élastiques différents et/ou utilisés différemment"} <br />
            <br />
            <strong> Attention: cela reste une estimation ! </strong> <br />
            <br />
            - Les élastiques sur le marché sont tous différents, nous avons pris une moyenne de ce qui se fait <br />
            - {"Il vous sera difficile de juger avec précision la longueur d'étirement"} <br />
            - Avec le temps, les élastiques se détendent <br />
            <br />
            <i> {"Une mesure, qu'elle soit estimée ou non, reste essentielle pour juger l'utilisation des élastiques"} </i> <br />
            <br />
            <strong> Et si je veux mesurer la tension de mes élastiques avec précision ? </strong> <br />
            <br />
            Utilisez un pèse baggage ou une balance de pêche bien sur ! <br />
            Voici une vidéo dédiée sur YouTube: <br />
            <a style={{ color: "#9b0000" }} href="https://www.youtube.com/watch?v=otQgOt1-qAw"> Mesure précisement son élastique </a> <br />
            <br />
            <i> {"Cliques à nouveau sur l'icône"} <img className="myDIV" src={require('../../../images/icons/icons8-question-mark-96.webp')} alt="?" /> {"pour faire disparaître ce bandeau d'information"} </i>
        </div>
    )
}

module.exports = VarianteHiddenText;