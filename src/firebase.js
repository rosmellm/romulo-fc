import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCsmzGN3-0K1kW9G1TLaApz-U",
  authDomain: "romulo-fc.firebaseapp.com",
  projectId: "romulo-fc",
  storageBucket: "romulo-fc.firebasestorage.app",
  messagingSenderId: "849856996590",
  appId: "1:849856996590:web:39b3900e7715",
  measurementId: "G-WSM1G7GNN3"
};

const app = initializeApp(firebaseConfig);
export const db  = getFirestore(app);
export const auth = getAuth(app);
