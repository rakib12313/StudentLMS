import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc, collection, getDocs, setDoc, addDoc, deleteDoc, updateDoc, serverTimestamp, query, orderBy } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

onAuthStateChanged(auth, async (user) => {
    if(!user) return location.href="index.html";
    const d = await getDoc(doc(db, "students", user.uid));
    if(!d.exists() || d.data().role !== "admin") return location.href="index.html";
    loadStats();
});

async function loadStats() {
    const u = await getDocs(collection(db, "students"));
    const n = await getDocs(collection(db, "notes"));
    document.getElementById('stat-users').innerText = u.size;
    document.getElementById('stat-notes').innerText = n.size;
    loadUsers();
}

// User Mgmt
window.loadUsers = async () => {
    const list = document.getElementById('user-list');
    list.innerHTML = '<p class="p-4 text-xs">Loading...</p>';
    const snaps = await getDocs(query(collection(db, "students"), orderBy("createdAt", "desc")));
    let html = '';
    snaps.forEach(d => {
        const u = d.data();
        html += `
        <div class="p-3 flex justify-between items-center hover:bg-slate-50">
            <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center font-bold text-xs text-indigo-700">${u.name?u.name[0]:'U'}</div>
                <div><span class="block text-xs font-bold">${u.name}</span><span class="text-[10px] text-slate-400">${u.email}</span></div>
            </div>
            <div class="flex gap-2">
                ${u.deviceId ? `<button onclick="resetDevice('${d.id}')" class="text-orange-500 hover:bg-orange-50 p-2"><i class="fas fa-unlock"></i></button>` : ''}
                <button onclick="deleteUser('${d.id}')" class="text-red-500 hover:bg-red-50 p-2"><i class="fas fa-trash"></i></button>
            </div>
        </div>`;
    });
    list.innerHTML = html;
};
window.resetDevice = async (id) => { if(confirm("Unlock Device?")) { await updateDoc(doc(db,"students",id),{deviceId:null}); loadUsers(); }};
window.deleteUser = async (id) => { if(confirm("Delete User?")) { await deleteDoc(doc(db,"students",id)); loadUsers(); }};

// Content Uploaders
document.getElementById('upload-note-btn').addEventListener('click', async () => {
    const file = document.getElementById('note-file').files[0];
    if(!file) return alert("Select File");
    const f = new FormData(); f.append('file', file); f.append('upload_preset', 'lms_upload');
    const r = await fetch('https://api.cloudinary.com/v1_1/dpe74ejhl/upload', {method:'POST', body:f});
    const d = await r.json();
    await addDoc(collection(db, "notes"), {
        title: document.getElementById('note-title').value, 
        batch: document.getElementById('note-batch').value,
        url: d.secure_url, type: 'pdf', createdAt: serverTimestamp()
    });
    alert("Note Uploaded!");
});

window.uploadVideo = async () => {
    await addDoc(collection(db, "videos"), {
        title: document.getElementById('vid-title').value,
        url: document.getElementById('vid-url').value,
        batch: document.getElementById('vid-batch').value,
        createdAt: serverTimestamp()
    });
    alert("Video Added!");
};

window.addFlashcard = async () => {
    await addDoc(collection(db, "flashcards"), {
        front: document.getElementById('fc-front').value,
        back: document.getElementById('fc-back').value,
        createdAt: serverTimestamp()
    });
    alert("Card Added!");
};

window.postHW = async () => {
    await addDoc(collection(db, "assignments"), {
        title: document.getElementById('hw-title').value,
        date: document.getElementById('hw-date').value,
        createdAt: serverTimestamp()
    });
    alert("Homework Posted!");
};

// Exam Logic
window.genKeys = () => {
    const c = document.getElementById('pe-count').value;
    let h = ''; for(let i=0; i<c; i++) h += `<select class="pk border rounded p-1 text-[10px]"><option value="0">A</option><option value="1">B</option><option value="2">C</option><option value="3">D</option></select>`;
    document.getElementById('pe-keys').innerHTML = h;
};
window.pubPDF = async () => {
    const file = document.getElementById('pe-file').files[0];
    const f = new FormData(); f.append('file', file); f.append('upload_preset', 'lms_upload');
    const r = await fetch('https://api.cloudinary.com/v1_1/dpe74ejhl/upload', {method:'POST', body:f});
    const d = await r.json();
    const keys = []; document.querySelectorAll('.pk').forEach(s => keys.push(parseInt(s.value)));
    await addDoc(collection(db,"exams"), {
        title: document.getElementById('pe-title').value,
        duration: document.getElementById('pe-dur').value,
        batch: document.getElementById('pe-batch').value,
        fileUrl: d.secure_url, answerKey: keys, type: "pdf_exam", createdAt: serverTimestamp()
    });
    alert("Exam Published");
};

// Live & Banner
window.toggleLive = async () => {
    const active = document.getElementById('live-toggle').checked;
    await setDoc(doc(db,"settings","live"), { active, topic:document.getElementById('live-topic').value, url:document.getElementById('live-url').value });
    if(active) alert("Live!");
};
window.updateAnnouncement = async () => setDoc(doc(db,"settings","announcement"), { text: document.getElementById('announce-text').value });
window.signOutAdmin = () => signOut(auth).then(()=>location.href="index.html");