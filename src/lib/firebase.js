import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBpPBNWykdZZ6ukjelAA3xjMUMNMowwZb4",
  authDomain: "hackprinceton-shapeup.firebaseapp.com",
  projectId: "hackprinceton-shapeup",
  storageBucket: "hackprinceton-shapeup.firebasestorage.app",
  messagingSenderId: "379851512921",
  appId: "1:379851512921:web:9cbda9756068b53c4e6548",
  measurementId: "G-6GYG8QNW3H"
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

export { app, db, storage };
