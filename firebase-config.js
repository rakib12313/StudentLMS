// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyBEMPS8vEJztGpoBPJjJIzKKInyt4IY9rQ",
    authDomain: "studentlms-79722.firebaseapp.com",
    projectId: "studentlms-79722",
    storageBucket: "studentlms-79722.firebasestorage.app",
    messagingSenderId: "1029623857004",
    appId: "1:1029623857004:web:fa07cb3de1270990a87d49"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app); // We keep this just in case, though we use Cloudinary
export const provider = new GoogleAuthProvider();