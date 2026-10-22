/*!************************************************************************
\file LoginDialog.h
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 23-10-2026
\brief
Declares LoginDialog, the "Sign In" window: server address, email,
password and "Remember me". It signs in through BackendClient with the
same account as the web app and stays open with the server's message if
that fails. Accepted once the user is signed in.
**************************************************************************/
#pragma once

#include <QDialog>

class BackendClient;
class QCheckBox;
class QDialogButtonBox;
class QLabel;
class QLineEdit;

class LoginDialog : public QDialog {
    Q_OBJECT

public:
    explicit LoginDialog(BackendClient* client, QWidget* parent = nullptr);

    void reject() override;

private:
    void submit();
    void setBusy(bool busy);

    BackendClient* m_client = nullptr;
    QLineEdit* m_server = nullptr;
    QLineEdit* m_email = nullptr;
    QLineEdit* m_password = nullptr;
    QCheckBox* m_remember = nullptr;
    QLabel* m_error = nullptr;
    QDialogButtonBox* m_buttons = nullptr;
    bool m_busy = false;
};
