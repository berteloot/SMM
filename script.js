document.getElementById('registrationForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = document.getElementById('submitBtn');
    const btnText = submitBtn.querySelector('.btn-text');
    const btnLoader = submitBtn.querySelector('.btn-loader');
    const successMessage = document.getElementById('successMessage');
    const errorMessage = document.getElementById('errorMessage');

    // Hide previous messages
    successMessage.style.display = 'none';
    errorMessage.style.display = 'none';

    // Show loader
    submitBtn.disabled = true;
    btnText.style.display = 'none';
    btnLoader.style.display = 'inline-flex';

    // Collect form data
    const formData = {
        firstName: document.getElementById('firstName').value,
        lastName: document.getElementById('lastName').value,
        email: document.getElementById('email').value,
        phone: document.getElementById('phone').value,
        company: document.getElementById('company').value,
        message: document.getElementById('message').value,
        timestamp: new Date().toISOString()
    };

    try {
        const response = await fetch('/.netlify/functions/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(formData)
        });

        if (response.ok) {
            // Success
            successMessage.style.display = 'flex';
            document.getElementById('registrationForm').reset();

            // Scroll to success message
            successMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            // Error - log the response details
            const errorData = await response.json().catch(() => ({}));
            console.error('Server error:', response.status, errorData);
            throw new Error(errorData.details || errorData.error || 'Registration failed');
        }
    } catch (error) {
        console.error('Error:', error);
        errorMessage.style.display = 'flex';
        errorMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } finally {
        // Reset button state
        submitBtn.disabled = false;
        btnText.style.display = 'inline';
        btnLoader.style.display = 'none';
    }
});

// Phone number formatting
document.getElementById('phone').addEventListener('input', (e) => {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length > 0) {
        if (value.length <= 3) {
            value = `+${value}`;
        } else if (value.length <= 6) {
            value = `+${value.slice(0, 1)} (${value.slice(1, 4)}) ${value.slice(4)}`;
        } else if (value.length <= 10) {
            value = `+${value.slice(0, 1)} (${value.slice(1, 4)}) ${value.slice(4, 7)}-${value.slice(7)}`;
        } else {
            value = `+${value.slice(0, 1)} (${value.slice(1, 4)}) ${value.slice(4, 7)}-${value.slice(7, 11)}`;
        }
    }
    e.target.value = value;
});
