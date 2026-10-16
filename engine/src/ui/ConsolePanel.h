/*!************************************************************************
\file ConsolePanel.h
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 15-10-2026
\brief
Declares ConsolePanel, the editor's "Console" dock contents. While it
exists it captures std::cout, std::cerr and Qt's qDebug/qInfo/qWarning
output and shows each line, timestamped and colour-coded by severity. The
captured streams are still echoed to their original destinations, so the
terminal that launched the engine sees everything too.
**************************************************************************/
#pragma once

#include <QWidget>

#include <deque>
#include <memory>

class QLabel;
class QPlainTextEdit;
class QComboBox;

class ConsolePanel : public QWidget {
    Q_OBJECT

public:
    enum class Level { Info, Warning, Error };

    // Installs the stream and Qt message redirection. Only one ConsolePanel
    // should exist at a time.
    explicit ConsolePanel(QWidget* parent = nullptr);
    // Restores the original streams and message handler.
    ~ConsolePanel() override;

    // Thread safe: may be called from any thread; the line is appended on the
    // GUI thread.
    void post(Level level, const QString& text);

private:
    class StreamRedirect; // std::streambuf that forwards whole lines to post()

    // Every line posted (up to a cap), so changing the filter can rebuild the view.
    struct Entry {
        Level level;
        QString html;
    };

    void append(Level level, const QString& text);
    bool passesFilter(Level level) const;

    QPlainTextEdit* m_output = nullptr;
    QComboBox* m_filter = nullptr;
    QLabel* m_counts = nullptr;
    int m_warningCount = 0;
    int m_errorCount = 0;
    std::deque<Entry> m_entries;

    std::unique_ptr<StreamRedirect> m_coutRedirect;
    std::unique_ptr<StreamRedirect> m_cerrRedirect;
};
