import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc, collection, getDocs, setDoc, addDoc, deleteDoc, query, orderBy, serverTimestamp, where } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "index.html"; }
    else {
        const docSnap = await getDoc(doc(db, "students", user.uid));
        if (!docSnap.exists() || docSnap.data().role !== "admin") {
            alert("⛔ Authorized Personnel Only");
            window.location.href = "index.html";
        } else {
            loadStats(); loadUsers(); loadContentList();
        }
    }
});

async function loadStats() {
    const u = await getDocs(collection(db, "students"));
    const n = await getDocs(collection(db, "notes"));
    const e = await getDocs(collection(db, "exams"));
    document.getElementById('stat-users').innerText = u.size;
    document.getElementById('stat-notes').innerText = n.size;
    document.getElementById('stat-exams').innerText = e.size;
}

window.loadUsers = async () => {
    const list = document.getElementById('user-list'); list.innerHTML = "<p class='p-2 text-xs'>Loading...</p>";
    const snaps = await getDocs(collection(db, "students")); list.innerHTML = "";
    snaps.forEach(doc => {
        const u = doc.data();
        list.innerHTML += `<div class="flex justify-between items-center p-3 hover:bg-slate-50"><div class="flex items-center gap-3"><img src="${u.photo}" class="w-8 h-8 rounded-full bg-slate-200"><div><div class="text-xs font-bold text-slate-700">${u.name}</div><div class="text-[10px] text-slate-400">${u.email}</div></div></div><div class="flex items-center gap-2">${u.role !== 'admin' ? `<button onclick="deleteUser('${doc.id}')" class="text-red-400 hover:text-red-600"><i class="fas fa-trash"></i></button>` : `<span class="text-[9px] font-bold text-blue-600">ADMIN</span>`}</div></div>`;
    });
};

window.registerStudent = async () => {
    const email = document.getElementById('new-email').value.trim();
    if(!email) return alert("Enter email");
    const q = query(collection(db, "students"), where("email", "==", email));
    const snap = await getDocs(q);
    if(!snap.empty) return alert("Exists");
    await addDoc(collection(db, "students"), { email, name: "New Student", role: "student", approved: true, photo: "https://cdn-icons-png.flaticon.com/512/149/149071.png" });
    alert("User Added"); document.getElementById('new-email').value = ""; loadUsers(); loadStats();
};
window.deleteUser = async (id) => { if(confirm("Delete user?")) { await deleteDoc(doc(db, "students", id)); loadUsers(); loadStats(); } };

async function loadContentList() {
    const nList = document.getElementById('del-notes-list'); nList.innerHTML = "";
    const nSnaps = await getDocs(query(collection(db, "notes"), orderBy("createdAt", "desc")));
    nSnaps.forEach(doc => nList.innerHTML += `<div class="flex justify-between p-2 hover:bg-red-50 rounded"><span class="text-xs truncate w-32">${doc.data().title}</span><button onclick="delContent('notes','${doc.id}')" class="text-red-300 hover:text-red-600"><i class="fas fa-trash"></i></button></div>`);
    const eList = document.getElementById('del-exams-list'); eList.innerHTML = "";
    const eSnaps = await getDocs(query(collection(db, "exams"), orderBy("createdAt", "desc")));
    eSnaps.forEach(doc => eList.innerHTML += `<div class="flex justify-between p-2 hover:bg-red-50 rounded"><span class="text-xs truncate w-32">${doc.data().title}</span><button onclick="delContent('exams','${doc.id}')" class="text-red-300 hover:text-red-600"><i class="fas fa-trash"></i></button></div>`);
}
window.delContent = async (col, id) => { if(confirm("Delete item?")) { await deleteDoc(doc(db, col, id)); loadContentList(); loadStats(); } };

window.updateAnnouncement = async () => {
    const text = document.getElementById('announce-text').value;
    if(text) { await setDoc(doc(db, "settings", "announcement"), { text }); alert("Updated"); }
};

document.getElementById('upload-btn').addEventListener('click', async () => {
    const file = document.getElementById('note-file').files[0];
    const title = document.getElementById('note-title').value;
    const btn = document.getElementById('upload-btn'); const status = document.getElementById('upload-status');
    const CLOUD_NAME = "dpe74ejhl"; const UPLOAD_PRESET = "lms_upload";
    if(!file || !title) return alert("Missing fields");
    btn.disabled = true; btn.innerText = "Uploading...";
    const formData = new FormData(); formData.append('file', file); formData.append('upload_preset', UPLOAD_PRESET);
    try {
        const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/upload`, { method: 'POST', body: formData });
        const data = await res.json();
        if(data.error) throw new Error(data.error.message);
        const type = data.format === 'pdf' ? 'pdf' : 'image';
        await addDoc(collection(db, "notes"), { title, url: data.secure_url, type, createdAt: serverTimestamp() });
        status.innerText = "Success!"; document.getElementById('note-title').value = ""; loadContentList(); loadStats();
    } catch(e) { alert("Error: " + e.message); }
    btn.disabled = false; btn.innerText = "Upload";
});

window.addQuestion = () => {
    const c = document.getElementById('questions-list'); const i = c.children.length+1;
    const div = document.createElement('div'); div.className = "bg-slate-50 p-4 rounded-lg border border-slate-200 q-block relative";
    div.innerHTML = `<span class="absolute right-2 top-2 text-xs font-bold text-slate-300">Q${i}</span><input class="w-full border-b bg-transparent p-2 mb-2 font-bold text-sm q-text" placeholder="Question Text..."><div class="grid grid-cols-2 gap-2 mb-2">${[1,2,3,4].map(n => `<input class="bg-white border p-2 rounded text-xs q-opt${n}" placeholder="Option ${n}">`).join('')}</div><select class="w-full bg-blue-100 text-blue-700 p-2 rounded text-xs font-bold q-correct"><option value="1">Answer: Option 1</option><option value="2">Answer: Option 2</option><option value="3">Answer: Option 3</option><option value="4">Answer: Option 4</option></select>`;
    c.appendChild(div);
};

window.publishExam = async () => {
    const title = document.getElementById('exam-title').value; const dur = document.getElementById('exam-duration').value; const blocks = document.querySelectorAll('.q-block');
    if(!title || !dur || blocks.length === 0) return alert("Incomplete");
    const questions = []; blocks.forEach(b => { questions.push({ text: b.querySelector('.q-text').value, options: [b.querySelector('.q-opt1').value, b.querySelector('.q-opt2').value, b.querySelector('.q-opt3').value, b.querySelector('.q-opt4').value], correct: parseInt(b.querySelector('.q-correct').value)-1 }); });
    await addDoc(collection(db, "exams"), { title, duration: parseInt(dur), questions, createdAt: serverTimestamp() });
    alert("Exam Published!"); document.getElementById('exam-modal').classList.add('hidden'); loadContentList(); loadStats();
};

document.getElementById('logout-btn').addEventListener('click', () => signOut(auth).then(() => window.location.href = "index.html"));