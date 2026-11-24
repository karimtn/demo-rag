/* Catalogue de 20 annonces FICTIVES, partagé entre le navigateur et Node. */
(function (root) {
  const CARS = [
   {id:1, title:"Peugeot 3008 1.2 PureTech 130 Allure", price:19900, year:2020, km:48000, fuel:"essence", gearbox:"automatique", city:"Lyon", desc:"SUV familial, boîte automatique EAT8, écran tactile, régulateur adaptatif, entretien à jour."},
   {id:2, title:"Renault Captur 1.3 TCe 130 Intens", price:16500, year:2019, km:61000, fuel:"essence", gearbox:"automatique", city:"Lyon", desc:"Petit SUV urbain, boîte EDC, caméra de recul, Apple CarPlay, pneus neufs."},
   {id:3, title:"Volkswagen Golf 2.0 TDI 150 DSG7", price:18700, year:2019, km:84000, fuel:"diesel", gearbox:"automatique", city:"Paris", desc:"Compacte routière, boîte DSG, sièges chauffants, phares LED, carnet complet."},
   {id:4, title:"Citroën C3 Aircross 1.2 PureTech 110", price:13900, year:2018, km:72000, fuel:"essence", gearbox:"manuelle", city:"Lille", desc:"SUV citadin, faible consommation, régulateur, Bluetooth, idéal ville."},
   {id:5, title:"Toyota Yaris Hybride 1.5 100h", price:17800, year:2021, km:39000, fuel:"hybride", gearbox:"automatique", city:"Paris", desc:"Hybride non rechargeable, boîte automatique, 4,2 L/100 km, garantie constructeur."},
   {id:6, title:"Tesla Model 3 Standard Plus", price:28900, year:2021, km:52000, fuel:"electrique", gearbox:"automatique", city:"Paris", desc:"Berline électrique, autonomie 430 km, autopilote, recharge rapide, intérieur cuir."},
   {id:7, title:"Peugeot 208 1.2 PureTech 100 Active", price:12400, year:2020, km:45000, fuel:"essence", gearbox:"manuelle", city:"Nantes", desc:"Citadine récente, écran tactile, climatisation, faible kilométrage, première main."},
   {id:8, title:"Ford Focus 1.5 EcoBlue 120 Titanium", price:15900, year:2019, km:77000, fuel:"diesel", gearbox:"manuelle", city:"Bordeaux", desc:"Compacte confortable, GPS, régulateur, sièges chauffants, entretien récent."},
   {id:9, title:"BMW Série 3 320d Business Design", price:27900, year:2020, km:69000, fuel:"diesel", gearbox:"automatique", city:"Paris", desc:"Berline premium, boîte automatique, cuir, navigation, caméra 360, historique complet."},
   {id:10, title:"Dacia Duster 1.3 TCe 130 Prestige", price:17900, year:2021, km:35000, fuel:"essence", gearbox:"manuelle", city:"Toulouse", desc:"SUV robuste, grand coffre, écran tactile, barres de toit, garantie restante."},
   {id:11, title:"Renault Zoé R135 Intens", price:11900, year:2019, km:41000, fuel:"electrique", gearbox:"automatique", city:"Lyon", desc:"Citadine électrique, autonomie 300 km, recharge domestique, idéale trajets urbains."},
   {id:12, title:"Audi A4 Avant 35 TDI S line", price:26500, year:2019, km:92000, fuel:"diesel", gearbox:"automatique", city:"Lille", desc:"Break familial, boîte S tronic, virtual cockpit, hayon électrique, entretien Audi."},
   {id:13, title:"Opel Corsa 1.2 Turbo 100 Elegance", price:13500, year:2020, km:38000, fuel:"essence", gearbox:"manuelle", city:"Nantes", desc:"Citadine moderne, Android Auto, caméra de recul, faible consommation."},
   {id:14, title:"Peugeot 5008 1.5 BlueHDi 130 GT", price:24900, year:2020, km:64000, fuel:"diesel", gearbox:"automatique", city:"Bordeaux", desc:"SUV 7 places, boîte EAT8, i-Cockpit, attelage, idéal famille nombreuse."},
   {id:15, title:"Hyundai Kona 64 kWh Executive", price:23900, year:2021, km:33000, fuel:"electrique", gearbox:"automatique", city:"Toulouse", desc:"SUV électrique, autonomie 480 km, charge rapide 80 % en 45 min, sièges chauffants."},
   {id:16, title:"Fiat 500 1.0 Hybrid Lounge", price:11900, year:2021, km:29000, fuel:"hybride", gearbox:"manuelle", city:"Paris", desc:"Mini citadine hybride, style rétro, toit ouvrant, parfaite pour la ville."},
   {id:17, title:"Volkswagen Polo 1.0 TSI 95 Life", price:14900, year:2020, km:42000, fuel:"essence", gearbox:"manuelle", city:"Lyon", desc:"Citadine polyvalente, écran digital, régulateur, historique limpide."},
   {id:18, title:"Skoda Octavia Combi 2.0 TDI 150", price:19900, year:2019, km:88000, fuel:"diesel", gearbox:"automatique", city:"Lille", desc:"Break spacieux, boîte DSG, coffre géant, GPS, très bonne routière."},
   {id:19, title:"Mini Cooper 1.5 136 Auto", price:18900, year:2020, km:47000, fuel:"essence", gearbox:"automatique", city:"Paris", desc:"Citadine premium, boîte automatique, toit panoramique, finition soignée."},
   {id:20, title:"Kia e-Niro 64 kWh Premium", price:22900, year:2020, km:51000, fuel:"electrique", gearbox:"automatique", city:"Nantes", desc:"SUV électrique, autonomie 455 km, charge rapide, garantie 7 ans."}
  ];  if (typeof module !== "undefined" && module.exports) module.exports = { CARS };
  else root.CATALOG = { CARS };
})(typeof globalThis !== "undefined" ? globalThis : this);
