// admin.js (Update register function only, rest is same as v10)
window.registerStudent = async () => {
    const email = document.getElementById('new-email').value.trim();
    if(!email) return alert("Enter email");
    
    // Check exist
    const q = query(collection(db, "students"), where("email", "==", email));
    const snap = await getDocs(q);
    if(!snap.empty) return alert("Email already registered");

    // Add to Whitelist
    await addDoc(collection(db, "students"), {
        email: email, 
        name: "New Student", 
        role: "student", 
        approved: true, 
        photo: "https://cdn-icons-png.flaticon.com/512/149/149071.png"
    });
    alert("User Added! Tell them to use 'Create Account' with this email."); 
    document.getElementById('new-email').value = ""; 
    loadUsers(); loadStats();
};
