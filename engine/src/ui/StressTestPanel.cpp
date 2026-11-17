#include "StressTestPanel.h"

#include <QDir>
#include <QFileDialog>
#include <QFileInfo>
#include <QHBoxLayout>
#include <QLabel>
#include <QListWidget>
#include <QPushButton>
#include <QStringList>
#include <QTimer>
#include <QVBoxLayout>

StressTestPanel::StressTestPanel(QWidget* parent)
	: QWidget(parent)
{
}

StressTestPanel::~StressTestPanel() = default;