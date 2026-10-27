/*!************************************************************************
\file LoginDialog.cpp
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 23-10-2026
\brief
Implements LoginDialog: the sign-in form, input checks, the warning before
a password is sent over plain HTTP to another machine, and the busy state
while BackendClient waits for the server.
**************************************************************************/
#include "ui/LoginDialog.h"

#include "net/BackendClient.h"

#include <QCheckBox>
#include <QDialogButtonBox>
#include <QFormLayout>
#include <QLabel>
#include <QLineEdit>
#include <QMessageBox>
#include <QPushButton>
#include <QVBoxLayout>

LoginDialog::LoginDialog(BackendClient* client, QWidget* parent)
    : QDialog(parent)
    , m_client(client) {
    setWindowTitle("Sign In");
    setMinimumWidth(380);

    auto* layout = new QVBoxLayout(this);

    auto* intro = new QLabel("Sign in with your Codefine web app account to open the models you uploaded.", this);
    intro->setWordWrap(true);
    layout->addWidget(intro);

    auto* form = new QFormLayout();
    m_server = new QLineEdit(client->serverUrl().toString(), this);
    m_server->setPlaceholderText("http://localhost:5005");
    m_server->setToolTip("Address of the machine running the Codefine backend (the web app's URL)");
    m_email = new QLineEdit(client->savedEmail(), this);
    m_email->setPlaceholderText("you@example.com");
    m_password = new QLineEdit(this);
    m_password->setEchoMode(QLineEdit::Password);
    m_remember = new QCheckBox("Remember me on this PC", this);
    m_remember->setToolTip("Stay signed in for 7 days. Only the session is saved, never your password.");
    form->addRow("Server", m_server);
    form->addRow("Email", m_email);
    form->addRow("Password", m_password);
    form->addRow(QString(), m_remember);
    layout->addLayout(form);

    m_error = new QLabel(this);
    m_error->setWordWrap(true);
    m_error->setStyleSheet("color: #e06c6c;");
    m_error->hide();
    layout->addWidget(m_error);

    m_buttons = new QDialogButtonBox(QDialogButtonBox::Ok | QDialogButtonBox::Cancel, this);
    m_buttons->button(QDialogButtonBox::Ok)->setText("Sign In");
    layout->addWidget(m_buttons);

    connect(m_buttons, &QDialogButtonBox::accepted, this, &LoginDialog::submit);
    connect(m_buttons, &QDialogButtonBox::rejected, this, &LoginDialog::reject);
    connect(m_client, &BackendClient::signInFinished, this, [this](bool ok, const QString& error) {
        if (!m_busy) {
            return;
        }
        setBusy(false);
        if (ok) {
            accept();
            return;
        }
        m_error->setText(error);
        m_error->show();
        m_password->selectAll();
        m_password->setFocus();
    });

    (m_email->text().isEmpty() ? m_email : m_password)->setFocus();
}

void LoginDialog::reject() {
    if (m_busy) {
        m_client->cancelSignIn();
        setBusy(false);
    }
    QDialog::reject();
}

void LoginDialog::submit() {
    const QUrl server = BackendClient::NormalizeServerUrl(m_server->text());
    const QString email = m_email->text().trimmed();
    QString problem;
    if (!server.isValid() || server.host().isEmpty()) {
        problem = "Enter the server address, e.g. http://localhost:5005.";
    } else if (email.isEmpty() || m_password->text().isEmpty()) {
        problem = "Enter your email and password.";
    }
    if (!problem.isEmpty()) {
        m_error->setText(problem);
        m_error->show();
        return;
    }

    if (BackendClient::IsInsecureRemote(server)) {
        const auto answer = QMessageBox::warning(
            this, "Unencrypted Connection",
            QString("%1 uses plain HTTP, so your password would be sent over the network "
                    "unencrypted.\n\nUse an https:// address if the server has one. Sign in anyway?")
                .arg(server.toString()),
            QMessageBox::Yes | QMessageBox::No, QMessageBox::No);
        if (answer != QMessageBox::Yes) {
            return;
        }
    }

    m_server->setText(server.toString());
    m_error->hide();
    setBusy(true);
    m_client->signIn(server, email, m_password->text(), m_remember->isChecked());
}

void LoginDialog::setBusy(bool busy) {
    m_busy = busy;
    for (QWidget* widget : { static_cast<QWidget*>(m_server), static_cast<QWidget*>(m_email),
                             static_cast<QWidget*>(m_password), static_cast<QWidget*>(m_remember) }) {
        widget->setEnabled(!busy);
    }
    QPushButton* ok = m_buttons->button(QDialogButtonBox::Ok);
    ok->setEnabled(!busy);
    ok->setText(busy ? "Signing In..." : "Sign In");
    setCursor(busy ? Qt::BusyCursor : Qt::ArrowCursor);
}
