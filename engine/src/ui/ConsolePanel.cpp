/*!************************************************************************
\file ConsolePanel.cpp
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 15-10-2026
\brief
Implements ConsolePanel: a std::streambuf that tees std::cout/std::cerr into
the panel line by line, a Qt message handler that does the same for
qDebug/qInfo/qWarning/qCritical, and the log view itself with a severity
filter, warning/error counters and a Clear button.
**************************************************************************/
#include "ui/ConsolePanel.h"

#include <QComboBox>
#include <QDateTime>
#include <QHBoxLayout>
#include <QLabel>
#include <QMetaObject>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QVBoxLayout>

#include <atomic>
#include <iostream>
#include <mutex>
#include <streambuf>
#include <string>

namespace {
    // Lines kept for re-filtering and shown in the view; older ones are dropped.
    constexpr int kMaxLines = 5000;

    // Filter combo indices.
    enum FilterIndex { kShowAll = 0, kShowWarningsAndErrors = 1, kShowErrors = 2 };

    // The live console, for the (static) Qt message handler. Null when none.
    std::atomic<ConsolePanel*> g_console{ nullptr };
    QtMessageHandler g_previousHandler = nullptr;

    void HandleQtMessage(QtMsgType type, const QMessageLogContext& context, const QString& message) {
        if (ConsolePanel* console = g_console.load()) {
            ConsolePanel::Level level = ConsolePanel::Level::Info;
            if (type == QtWarningMsg) level = ConsolePanel::Level::Warning;
            else if (type == QtCriticalMsg || type == QtFatalMsg) level = ConsolePanel::Level::Error;
            console->post(level, message);
        }
        // Keep Qt's default behaviour (stderr / debugger output) as well.
        if (g_previousHandler) {
            g_previousHandler(type, context, message);
        }
    }

    const char* LevelColour(ConsolePanel::Level level) {
        switch (level) {
        case ConsolePanel::Level::Warning: return "#e6b450";
        case ConsolePanel::Level::Error:   return "#f07178";
        default:                           return "#dcdcdc";
        }
    }

}

// Replaces a std::ostream's buffer for its lifetime. Characters are passed
// straight through to the original buffer (so the terminal still sees them)
// and also collected into lines, each of which is posted to the console.
class ConsolePanel::StreamRedirect : public std::streambuf {
public:
    StreamRedirect(std::ostream& stream, ConsolePanel& console, Level level)
        : m_stream(stream), m_previous(stream.rdbuf()), m_console(console), m_level(level) {
        m_stream.rdbuf(this);
    }

    ~StreamRedirect() override {
        m_stream.rdbuf(m_previous);
    }

protected:
    int_type overflow(int_type ch) override {
        if (traits_type::eq_int_type(ch, traits_type::eof())) {
            return traits_type::not_eof(ch);
        }
        const char c = traits_type::to_char_type(ch);

        // std::cout/cerr may be written from worker threads (e.g. the loader).
        std::lock_guard<std::mutex> lock(m_mutex);
        if (m_previous) {
            m_previous->sputc(c);
        }
        if (c == '\n') {
            m_console.post(m_level, QString::fromStdString(m_line));
            m_line.clear();
        } else if (c != '\r') {
            m_line.push_back(c);
        }
        return ch;
    }

    int sync() override {
        std::lock_guard<std::mutex> lock(m_mutex);
        return m_previous ? m_previous->pubsync() : 0;
    }

private:
    std::ostream& m_stream;
    std::streambuf* m_previous; // restored on destruction
    ConsolePanel& m_console;
    Level m_level;
    std::mutex m_mutex;
    std::string m_line;         // current, not yet terminated line
};

ConsolePanel::ConsolePanel(QWidget* parent)
    : QWidget(parent) {
    auto* layout = new QVBoxLayout(this);
    layout->setContentsMargins(4, 4, 4, 4);
    layout->setSpacing(4);

    auto* toolbar = new QHBoxLayout();
    auto* clearButton = new QPushButton("Clear", this);
    m_filter = new QComboBox(this);
    m_filter->addItems({ "All messages", "Warnings and errors", "Errors only" });
    m_counts = new QLabel(this);
    m_counts->setObjectName("PanelHint");
    toolbar->addWidget(clearButton);
    toolbar->addWidget(m_filter);
    toolbar->addStretch();
    toolbar->addWidget(m_counts);
    layout->addLayout(toolbar);

    m_output = new QPlainTextEdit(this);
    m_output->setReadOnly(true);
    m_output->setMaximumBlockCount(kMaxLines);
    m_output->setLineWrapMode(QPlainTextEdit::NoWrap);
    QFont mono("Consolas");
    mono.setStyleHint(QFont::Monospace);
    m_output->setFont(mono);
    layout->addWidget(m_output, 1);

    connect(clearButton, &QPushButton::clicked, this, [this] {
        m_entries.clear();
        m_output->clear();
        m_warningCount = 0;
        m_errorCount = 0;
        m_counts->clear();
    });

    connect(m_filter, &QComboBox::currentIndexChanged, this, [this] {
        m_output->clear();
        for (const Entry& entry : m_entries) {
            if (passesFilter(entry.level)) {
                m_output->appendHtml(entry.html);
            }
        }
    });

    m_coutRedirect = std::make_unique<StreamRedirect>(std::cout, *this, Level::Info);
    m_cerrRedirect = std::make_unique<StreamRedirect>(std::cerr, *this, Level::Error);
    g_console.store(this);
    g_previousHandler = qInstallMessageHandler(HandleQtMessage);
}

ConsolePanel::~ConsolePanel() {
    qInstallMessageHandler(g_previousHandler);
    g_console.store(nullptr);
    m_coutRedirect.reset();
    m_cerrRedirect.reset();
}

void ConsolePanel::post(Level level, const QString& text) {
    // Runs append() directly on the GUI thread, queued from any other thread.
    // Queued calls are dropped automatically if the panel is gone by then.
    QMetaObject::invokeMethod(this, [this, level, text] { append(level, text); });
}

void ConsolePanel::append(Level level, const QString& text) {
    const QString html = QString("<span style='color:#7a7a7f'>%1</span>&nbsp;&nbsp;"
                                 "<span style='color:%2; white-space:pre'>%3</span>")
                             .arg(QDateTime::currentDateTime().toString("HH:mm:ss"),
                                  LevelColour(level), text.toHtmlEscaped());

    m_entries.push_back({ level, html });
    if (static_cast<int>(m_entries.size()) > kMaxLines) {
        m_entries.pop_front();
    }

    if (level == Level::Warning) ++m_warningCount;
    else if (level == Level::Error) ++m_errorCount;
    m_counts->setText(QString("%1 warning%2, %3 error%4")
                          .arg(m_warningCount).arg(m_warningCount == 1 ? "" : "s")
                          .arg(m_errorCount).arg(m_errorCount == 1 ? "" : "s"));

    if (passesFilter(level)) {
        m_output->appendHtml(html);
    }
}

bool ConsolePanel::passesFilter(Level level) const {
    switch (m_filter->currentIndex()) {
    case kShowWarningsAndErrors: return level != Level::Info;
    case kShowErrors:            return level == Level::Error;
    default:                     return true;
    }
}
